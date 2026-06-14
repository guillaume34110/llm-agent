import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidTag } from '../tags';
import { validateWallAnswer, validateRationale, type WallMode } from '../schemas';
import { ModerationService } from '../moderation/moderation.service';
import { InquirySettingsService } from '../settings/inquiry-settings.service';

const POST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAILY_POST_LIMIT = 10;
const KEY_ROTATION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const PAYLOAD_MAX_BYTES = 4 * 1024;

const WALL_MODES = new Set<WallMode>(['find_collab', 'find_expertise', 'announce_project', 'rfc']);

@Injectable()
export class WallService {
  private readonly logger = new Logger(WallService.name);
  constructor(
    private prisma: PrismaService,
    private moderation: ModerationService,
    private settings: InquirySettingsService,
  ) {}

  // ---- Broadcast key (per tag, monthly rotation) ----
  async getActiveBroadcastKey(tag: string) {
    if (!isValidTag(tag)) throw new BadRequestException('bad tag');
    const k = await this.prisma.broadcastKey.findFirst({
      where: { tag, rotatedAt: null },
      orderBy: { generation: 'desc' },
    });
    if (k) return k;
    return this.rotateBroadcastKey(tag);
  }

  private async rotateBroadcastKey(tag: string) {
    // Server-side stub: in production the wrapped-key blob is produced by clients
    // (key-agreement among subscribers). Here we mint an opaque placeholder so
    // the server has a generation pointer; clients re-wrap and patch later.
    const wrappedKey = randomBytes(32);
    const last = await this.prisma.broadcastKey.findFirst({
      where: { tag },
      orderBy: { generation: 'desc' },
      select: { generation: true },
    });
    const generation = (last?.generation ?? 0) + 1;
    if (last) {
      await this.prisma.broadcastKey.updateMany({
        where: { tag, rotatedAt: null },
        data: { rotatedAt: new Date() },
      });
    }
    return this.prisma.broadcastKey.create({
      data: { tag, wrappedKey, generation },
    });
  }

  // ---- Pseudonym per (user, tag) ----
  async getOrCreatePseudonym(userId: string, tag: string): Promise<string> {
    if (!isValidTag(tag)) throw new BadRequestException('bad tag');
    const existing = await this.prisma.tagPseudonym.findUnique({
      where: { userId_tag: { userId, tag } },
    });
    if (existing) return existing.pseudonym;
    const pseudonym = randomBytes(12).toString('base64url');
    try {
      const row = await this.prisma.tagPseudonym.create({
        data: { userId, tag, pseudonym },
      });
      return row.pseudonym;
    } catch {
      const r = await this.prisma.tagPseudonym.findUnique({
        where: { userId_tag: { userId, tag } },
      });
      if (!r) throw new Error('pseudonym race');
      return r.pseudonym;
    }
  }

  // ---- Post ----
  async post(authorId: string, body: {
    tag: string;
    mode: WallMode;
    schemaVersion: string;
    payloadEnc: string; // base64 ciphertext under tag's BroadcastKey
    filters?: any;
    guardPassed: boolean;
  }) {
    // guardPassed is a client witness; real enforcement is provider-side (Llama-Guard, fail-closed).
    if (typeof body.guardPassed !== 'boolean') throw new BadRequestException('guardPassed required');
    if (!isValidTag(body.tag)) throw new BadRequestException('bad tag');
    if (!WALL_MODES.has(body.mode)) throw new BadRequestException('bad mode');
    if (typeof body.schemaVersion !== 'string' || body.schemaVersion.length > 32) {
      throw new BadRequestException('bad schemaVersion');
    }
    const payload = Buffer.from(body.payloadEnc, 'base64');
    if (payload.length === 0 || payload.length > PAYLOAD_MAX_BYTES) {
      throw new BadRequestException('bad payload size');
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.wallPost.count({
      where: { authorId, createdAt: { gte: since } },
    });
    if (recent >= DAILY_POST_LIMIT) throw new ForbiddenException('daily post limit reached');

    const key = await this.getActiveBroadcastKey(body.tag);
    const pseudonym = await this.getOrCreatePseudonym(authorId, body.tag);
    const expiresAt = new Date(Date.now() + POST_TTL_MS);

    return this.prisma.wallPost.create({
      data: {
        authorId,
        authorPseudonymForTag: pseudonym,
        tag: body.tag,
        mode: body.mode,
        schemaVersion: body.schemaVersion,
        payloadEnc: payload,
        keyGen: key.generation,
        filters: (body.filters ?? {}) as any,
        guardPassed: body.guardPassed,
        expiresAt,
      },
    });
  }

  async listByTag(viewerId: string, tag: string, limit = 50) {
    if (!isValidTag(tag)) throw new BadRequestException('bad tag');
    if (!(await this.settings.accepts(viewerId, 'find_collab', [tag]))
        && !(await this.settings.accepts(viewerId, 'find_expertise', [tag]))) {
      // Viewer must have at least one accepted mode for the tag to read the wall.
      // (Otherwise opting in for reading bypasses the per-mode brake.)
      throw new ForbiddenException('not opted-in for this tag');
    }
    const blocked = await this.moderation.pairwiseBlocked(viewerId);
    const rows = await this.prisma.wallPost.findMany({
      where: { tag, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return rows.filter(r => !blocked.has(r.authorId));
  }

  // ---- Reply ----
  async reply(responderId: string, postId: string, body: {
    answer: unknown;
    rationaleEnc?: string;
    guardPassed: boolean;
    agentSig?: string;
  }) {
    // guardPassed is a client witness; real enforcement is provider-side (Llama-Guard, fail-closed).
    if (typeof body.guardPassed !== 'boolean') throw new BadRequestException('guardPassed required');
    const post = await this.prisma.wallPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('post not found');
    if (post.expiresAt <= new Date()) throw new ForbiddenException('post expired');
    if (post.authorId === responderId) throw new ForbiddenException('cannot self-reply');

    if (await this.moderation.isBlockedPair(post.authorId, responderId)) {
      throw new ForbiddenException('blocked');
    }

    if (!(await this.settings.accepts(responderId, post.mode, [post.tag]))) {
      throw new ForbiddenException('not opted in for mode/tag');
    }

    const v = validateWallAnswer(post.mode, body.answer);
    if (!v.ok) throw new BadRequestException(`bad answer: ${v.reason}`);
    const r = validateRationale(body.rationaleEnc);
    if (!r.ok) throw new BadRequestException('bad rationale');

    const agentSig = body.agentSig ? Buffer.from(body.agentSig, 'base64') : null;
    if (agentSig && (agentSig.length === 0 || agentSig.length > 256)) {
      throw new BadRequestException('bad agentSig');
    }

    const pseudonym = await this.getOrCreatePseudonym(responderId, post.tag);

    try {
      return await this.prisma.wallReply.create({
        data: {
          postId,
          responderId,
          responderPseudonymForTag: pseudonym,
          answer: body.answer as any,
          rationaleEnc: r.bytes ?? null,
          guardPassed: body.guardPassed,
          agentSig,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ForbiddenException('already replied');
      throw e;
    }
  }

  async listReplies(viewerId: string, postId: string) {
    const post = await this.prisma.wallPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('post not found');
    if (post.authorId !== viewerId) {
      // Non-authors only see counts to prevent harvesting agent rationales.
      const count = await this.prisma.wallReply.count({ where: { postId } });
      return { count };
    }
    const blocked = await this.moderation.pairwiseBlocked(viewerId);
    const rows = await this.prisma.wallReply.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.filter(r => !blocked.has(r.responderId));
  }

  // ---- Cron: rotate keys monthly, purge expired posts ----
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async rotateStaleBroadcastKeys() {
    const cutoff = new Date(Date.now() - KEY_ROTATION_PERIOD_MS);
    const stale = await this.prisma.broadcastKey.findMany({
      where: { rotatedAt: null, createdAt: { lt: cutoff } },
      select: { tag: true },
      distinct: ['tag'],
    });
    for (const { tag } of stale) {
      try {
        await this.rotateBroadcastKey(tag);
      } catch (e: any) {
        this.logger.warn(`rotate ${tag} failed: ${e?.message ?? e}`);
      }
    }
    if (stale.length > 0) this.logger.log(`rotated ${stale.length} broadcast keys`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredPosts() {
    const res = await this.prisma.wallPost.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (res.count > 0) this.logger.log(`purged ${res.count} expired wall posts`);
  }
}
