import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';

const ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const DOC_MAX_BYTES = 5 * 1024 * 1024;
const DOC_MAX_PER_ROOM = 500;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  constructor(private prisma: PrismaService, private moderation: ModerationService) {}

  private async requireMember(userId: string, roomId: string) {
    const m = await this.prisma.projectMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!m || m.leftAt) throw new ForbiddenException('not a member');
    return m;
  }

  async listMine(userId: string) {
    const rows = await this.prisma.projectMember.findMany({
      where: { userId, leftAt: null },
      include: { room: true },
      orderBy: { joinedAt: 'desc' },
    });
    return rows.filter(r => !r.room.archivedAt).map(r => r.room);
  }

  async get(userId: string, roomId: string) {
    await this.requireMember(userId, roomId);
    const room = await this.prisma.projectRoom.findUnique({
      where: { id: roomId },
      include: { members: { where: { leftAt: null } }, channelStates: true },
    });
    if (!room) throw new NotFoundException('room not found');
    return room;
  }

  async leave(userId: string, roomId: string) {
    await this.requireMember(userId, roomId);
    await this.prisma.projectMember.update({
      where: { roomId_userId: { roomId, userId } },
      data: { leftAt: new Date() },
    });
    return { ok: true };
  }

  async setHumanChat(userId: string, roomId: string, accept: boolean) {
    await this.requireMember(userId, roomId);
    return this.prisma.projectChannelState.upsert({
      where: { roomId_userId: { roomId, userId } },
      update: { acceptHumanChat: !!accept },
      create: { roomId, userId, acceptHumanChat: !!accept },
    });
  }

  // Returns the subset of co-members who have both opted in to human-chat
  // AND have not blocked the caller.
  async humanChatPeers(userId: string, roomId: string) {
    await this.requireMember(userId, roomId);
    const [self, all] = await Promise.all([
      this.prisma.projectChannelState.findUnique({
        where: { roomId_userId: { roomId, userId } },
      }),
      this.prisma.projectChannelState.findMany({ where: { roomId } }),
    ]);
    if (!self?.acceptHumanChat) return [];
    const blocked = await this.moderation.pairwiseBlocked(userId);
    return all
      .filter(s => s.userId !== userId && s.acceptHumanChat && !blocked.has(s.userId))
      .map(s => s.userId);
  }

  async uploadDoc(userId: string, roomId: string, body: {
    ciphertext: string;
    mimeType: string;
    sizeBytes: number;
    keyGen?: number;
  }) {
    await this.requireMember(userId, roomId);
    const buf = Buffer.from(body.ciphertext, 'base64');
    if (buf.length === 0 || buf.length > DOC_MAX_BYTES) throw new BadRequestException('bad ciphertext size');
    if (body.sizeBytes !== buf.length) throw new BadRequestException('sizeBytes mismatch');
    if (typeof body.mimeType !== 'string' || body.mimeType.length > 128) throw new BadRequestException('bad mime');

    const count = await this.prisma.projectDoc.count({ where: { roomId } });
    if (count >= DOC_MAX_PER_ROOM) throw new ForbiddenException('doc limit reached');

    const doc = await this.prisma.projectDoc.create({
      data: {
        roomId,
        uploaderId: userId,
        ciphertext: buf,
        mimeType: body.mimeType,
        sizeBytes: buf.length,
        keyGen: body.keyGen ?? 1,
      },
    });
    await this.touch(roomId);
    return { id: doc.id, createdAt: doc.createdAt, keyGen: doc.keyGen, sizeBytes: doc.sizeBytes };
  }

  async listDocs(userId: string, roomId: string) {
    await this.requireMember(userId, roomId);
    return this.prisma.projectDoc.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, uploaderId: true, mimeType: true, sizeBytes: true, keyGen: true, createdAt: true },
    });
  }

  async getDoc(userId: string, roomId: string, docId: string) {
    await this.requireMember(userId, roomId);
    const doc = await this.prisma.projectDoc.findFirst({ where: { id: docId, roomId } });
    if (!doc) throw new NotFoundException('doc not found');
    return {
      id: doc.id,
      uploaderId: doc.uploaderId,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      keyGen: doc.keyGen,
      createdAt: doc.createdAt,
      ciphertext: doc.ciphertext.toString('base64'),
    };
  }

  async deleteDoc(userId: string, roomId: string, docId: string) {
    const member = await this.requireMember(userId, roomId);
    const doc = await this.prisma.projectDoc.findFirst({ where: { id: docId, roomId } });
    if (!doc) throw new NotFoundException('doc not found');
    const isAdmin = member.role === 'admin' || member.role === 'owner';
    if (doc.uploaderId !== userId && !isAdmin) {
      throw new ForbiddenException('only uploader or room admin can delete');
    }
    await this.prisma.projectDoc.delete({ where: { id: docId } });
    return { ok: true };
  }

  private async touch(roomId: string) {
    await this.prisma.projectRoom.updateMany({
      where: { id: roomId, archivedAt: null },
      data: { lastActivityAt: new Date() },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async autoArchiveStaleRooms() {
    const cutoff = new Date(Date.now() - ARCHIVE_AFTER_MS);
    const res = await this.prisma.projectRoom.updateMany({
      where: { archivedAt: null, lastActivityAt: { lt: cutoff } },
      data: { archivedAt: new Date() },
    });
    if (res.count > 0) this.logger.log(`auto-archived ${res.count} stale project rooms`);
  }
}
