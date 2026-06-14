import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// 4 MiB cap on a shared conversation blob. Larger conversations should be
// chunked client-side or the user warned. Server only stores opaque ciphertext.
const MAX_BLOB_BYTES = 4 * 1024 * 1024;
// Anti-abuse quota: a single user can own at most this many live shared blobs.
// New POSTs beyond the cap are rejected with 429-ish ConflictException (the
// client can delete an old blob to free a slot).
const MAX_BLOBS_PER_USER = 100;
// Blobs older than this are purged by a daily cron. Share URLs are meant for
// one-shot transfer, not long-term hosting.
const BLOB_TTL_DAYS = 90;
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$/;

// Static allowlist of avatar cosmetic IDs (mirrors desktop cosmetics-client).
// Demonetization (2026-05-25): everything is free, this just validates that
// the client isn't writing arbitrary strings into PublicProfile.avatarCosmeticId.
const ALLOWED_AVATAR_COSMETICS = new Set<string>([
  'monkey', 'panda', 'fox', 'cat', 'wolf', 'dragon',
  'skin-noir', 'skin-pastel', 'frame-gold',
]);

interface ProfileUpdate {
  handle?: string;
  bio?: string;
  avatarCosmeticId?: string | null;
}

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
  constructor(private prisma: PrismaService) {}

  async getProfileByHandle(handle: string) {
    if (!HANDLE_RE.test(handle)) throw new NotFoundException();
    const p = await this.prisma.publicProfile.findUnique({ where: { handle } });
    if (!p) throw new NotFoundException();
    return { handle: p.handle, bio: p.bio, avatarCosmeticId: p.avatarCosmeticId, createdAt: p.createdAt };
  }

  async getOwnProfile(userId: string) {
    const p = await this.prisma.publicProfile.findUnique({ where: { userId } });
    if (!p) return null;
    return { handle: p.handle, bio: p.bio, avatarCosmeticId: p.avatarCosmeticId, createdAt: p.createdAt };
  }

  async upsertProfile(userId: string, body: ProfileUpdate) {
    if (body.handle != null && !HANDLE_RE.test(body.handle)) {
      throw new BadRequestException('handle must be 2-32 chars, [a-z0-9_-], not starting or ending with -/_');
    }
    if (body.bio != null && body.bio.length > 280) {
      throw new BadRequestException('bio max 280 chars');
    }
    if (body.avatarCosmeticId && !ALLOWED_AVATAR_COSMETICS.has(body.avatarCosmeticId)) {
      throw new NotFoundException('avatar cosmetic not in catalog');
    }
    try {
      const existing = await this.prisma.publicProfile.findUnique({ where: { userId } });
      if (!existing) {
        if (!body.handle) throw new BadRequestException('handle required for first profile creation');
        const p = await this.prisma.publicProfile.create({
          data: {
            userId,
            handle: body.handle,
            bio: body.bio ?? null,
            avatarCosmeticId: body.avatarCosmeticId ?? null,
          },
        });
        return { handle: p.handle, bio: p.bio, avatarCosmeticId: p.avatarCosmeticId };
      }
      const p = await this.prisma.publicProfile.update({
        where: { userId },
        data: {
          ...(body.handle !== undefined && { handle: body.handle }),
          ...(body.bio !== undefined && { bio: body.bio }),
          ...(body.avatarCosmeticId !== undefined && { avatarCosmeticId: body.avatarCosmeticId }),
        },
      });
      return { handle: p.handle, bio: p.bio, avatarCosmeticId: p.avatarCosmeticId };
    } catch (e: any) {
      // P2002 = unique constraint violation. Both first-create races and
      // updates to an already-taken handle land here.
      if (e?.code === 'P2002') throw new ConflictException('handle already taken');
      throw e;
    }
  }

  async deleteProfile(userId: string) {
    await this.prisma.publicProfile.deleteMany({ where: { userId } });
    return { ok: true };
  }

  async createSharedConversation(userId: string, encryptedBlob: Buffer) {
    if (!encryptedBlob || encryptedBlob.length === 0) {
      throw new BadRequestException('encryptedBlob required');
    }
    if (encryptedBlob.length > MAX_BLOB_BYTES) {
      throw new BadRequestException(`blob too large (max ${MAX_BLOB_BYTES} bytes)`);
    }
    const owned = await this.prisma.sharedConversation.count({ where: { ownerId: userId } });
    if (owned >= MAX_BLOBS_PER_USER) {
      throw new ConflictException(`shared conversation quota reached (${MAX_BLOBS_PER_USER}); delete one to free a slot`);
    }
    const row = await this.prisma.sharedConversation.create({
      data: { ownerId: userId, encryptedBlob },
    });
    return { id: row.id, createdAt: row.createdAt };
  }

  async getSharedConversation(id: string) {
    const row = await this.prisma.sharedConversation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return { id: row.id, encryptedBlob: row.encryptedBlob, createdAt: row.createdAt };
  }

  async deleteSharedConversation(userId: string, id: string) {
    const row = await this.prisma.sharedConversation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    if (row.ownerId !== userId) throw new ForbiddenException();
    await this.prisma.sharedConversation.delete({ where: { id } });
    return { ok: true };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredBlobs() {
    if (process.env.PROGSOFT_DISABLE_BLOB_PURGE === '1') return;
    const cutoff = new Date(Date.now() - BLOB_TTL_DAYS * 24 * 60 * 60 * 1000);
    const res = await this.prisma.sharedConversation.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (res.count > 0) this.logger.log(`Purged ${res.count} shared conversation blob(s) older than ${BLOB_TTL_DAYS}d`);
  }
}
