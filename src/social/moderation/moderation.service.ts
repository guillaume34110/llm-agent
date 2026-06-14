import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const SIGNAL_REASONS = new Set(['spam', 'harass', 'leak', 'guard_bypass', 'other']);
const SIGNAL_TARGETS = new Set(['inquiry', 'inquiry_response', 'wall_post', 'wall_reply', 'project_member']);
const MAX_NOTE_CHARS = 500;

@Injectable()
export class ModerationService {
  constructor(private prisma: PrismaService) {}

  // Block — bidirectional cut on all social surfaces. Subsequent reads of
  // block state happen on hot paths, so callers should batch via
  // listBlockedFor / isBlocked.
  async block(blockerId: string, blockedId: string, reason?: string) {
    if (blockerId === blockedId) throw new BadRequestException('cannot block self');
    try {
      return await this.prisma.userBlock.create({
        data: { blockerId, blockedId, reason: reason?.slice(0, 200) ?? null },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('already blocked');
      throw e;
    }
  }

  async unblock(blockerId: string, blockedId: string) {
    const res = await this.prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
    if (res.count === 0) throw new NotFoundException('not blocked');
    return { ok: true };
  }

  async listBlocked(blockerId: string): Promise<string[]> {
    const rows = await this.prisma.userBlock.findMany({ where: { blockerId }, select: { blockedId: true } });
    return rows.map(r => r.blockedId);
  }

  // Hot path: returns the set of users who blocked `userId` AND the users
  // `userId` has blocked. Both sides exclude each other from discovery.
  async pairwiseBlocked(userId: string): Promise<Set<string>> {
    const [out, inb] = await Promise.all([
      this.prisma.userBlock.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
      this.prisma.userBlock.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
    ]);
    const s = new Set<string>();
    for (const r of out) s.add(r.blockedId);
    for (const r of inb) s.add(r.blockerId);
    return s;
  }

  async isBlockedPair(a: string, b: string): Promise<boolean> {
    const row = await this.prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
      select: { id: true },
    });
    return !!row;
  }

  // Signal — append-only, queued for moderator review. No automated takedown;
  // the cron + admin tooling decide. Anti-abuse: rate-limited at controller.
  async signal(input: {
    reporterId: string;
    targetUserId: string;
    targetKind: string;
    targetId: string;
    reason: string;
    note?: string;
  }) {
    if (!SIGNAL_TARGETS.has(input.targetKind)) throw new BadRequestException('bad target kind');
    if (!SIGNAL_REASONS.has(input.reason)) throw new BadRequestException('bad reason');
    if (input.note && input.note.length > MAX_NOTE_CHARS) throw new BadRequestException('note too long');
    if (input.reporterId === input.targetUserId) throw new BadRequestException('cannot self-signal');
    return this.prisma.userSignal.create({
      data: {
        reporterId: input.reporterId,
        targetUserId: input.targetUserId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        reason: input.reason,
        note: input.note ?? null,
      },
    });
  }
}
