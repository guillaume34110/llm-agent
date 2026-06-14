import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Friend-graph P2P presence directory.
// Server stores ONLY routing meta (modelId, networkAddr, noisePubkey, attested).
// Never prompts, never responses, never who routed what to whom.
// Default ACL: closed. A friend appears in /friends presence iff:
//   1. there is a Friendship row both directions (mutual), AND
//   2. provider has a ProviderAcl row for that friend (opt-in).
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  constructor(private prisma: PrismaService) {}

  async announce(opts: {
    userId: string;
    deviceId: string;
    modelId: string;
    networkAddr: string;
    noisePubkey: string;
    modelDigest?: string | null;
    weightDigest?: string | null;
    task?: string | null;
  }) {
    // Resolve task from catalog if provider didn't send one (legacy clients).
    let task = opts.task ?? null;
    if (!task) {
      const meta = await this.prisma.modelMeta.findUnique({
        where: { id: opts.modelId },
        select: { task: true },
      });
      task = meta?.task ?? null;
    }
    return this.prisma.providerRegistration.upsert({
      where: { userId_deviceId_modelId: { userId: opts.userId, deviceId: opts.deviceId, modelId: opts.modelId } },
      update: {
        networkAddr: opts.networkAddr,
        noisePubkey: opts.noisePubkey,
        modelDigest: opts.modelDigest ?? null,
        weightDigest: opts.weightDigest ?? null,
        task,
        lastSeenAt: new Date(),
      },
      create: {
        userId: opts.userId,
        deviceId: opts.deviceId,
        modelId: opts.modelId,
        networkAddr: opts.networkAddr,
        noisePubkey: opts.noisePubkey,
        modelDigest: opts.modelDigest ?? null,
        weightDigest: opts.weightDigest ?? null,
        task,
      },
    });
  }

  async setAttested(userId: string, modelId: string, attested: boolean, deviceId?: string) {
    const r = await this.prisma.providerRegistration.updateMany({
      where: { userId, modelId, ...(deviceId ? { deviceId } : {}) },
      data: { attested },
    });
    return { updated: r.count };
  }

  async withdraw(userId: string, opts: { modelId?: string; deviceId?: string } = {}) {
    const where: any = { userId };
    if (opts.modelId) where.modelId = opts.modelId;
    if (opts.deviceId) where.deviceId = opts.deviceId;
    const r = await this.prisma.providerRegistration.deleteMany({ where });
    return { withdrawn: r.count };
  }

  // Self-routing: list this user's own provider rows, optionally excluding the
  // calling device so the consumer doesn't try to ping the same machine it's
  // running on. No friendship/ACL check — same user owns both sides.
  async listMyDevices(userId: string, opts: { excludeDeviceId?: string; modelId?: string; task?: string; sinceMinutes?: number } = {}) {
    const since = new Date(Date.now() - (opts.sinceMinutes ?? 5) * 60_000);
    return this.prisma.providerRegistration.findMany({
      where: {
        userId,
        lastSeenAt: { gte: since },
        ...(opts.excludeDeviceId ? { deviceId: { not: opts.excludeDeviceId } } : {}),
        ...(opts.modelId ? { modelId: opts.modelId } : {}),
        ...(opts.task ? { task: opts.task } : {}),
      },
      select: {
        userId: true,
        deviceId: true,
        modelId: true,
        task: true,
        networkAddr: true,
        noisePubkey: true,
        modelDigest: true,
        weightDigest: true,
        attested: true,
        lastSeenAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  // Returns mutual friends that have opted me in via ProviderAcl (provider→friend).
  // For each such provider, return their currently-announced models.
  async listFriendProviders(askingUserId: string, opts: { modelId?: string; task?: string; sinceMinutes?: number } = {}) {
    const since = new Date(Date.now() - (opts.sinceMinutes ?? 5) * 60_000);
    const mutualA = await this.prisma.friendship.findMany({
      where: { userId: askingUserId },
      select: { friendId: true },
    });
    if (mutualA.length === 0) return [];
    const candidates = mutualA.map((f) => f.friendId);

    const reverse = await this.prisma.friendship.findMany({
      where: { userId: { in: candidates }, friendId: askingUserId },
      select: { userId: true },
    });
    const mutuals = new Set(reverse.map((r) => r.userId));
    if (mutuals.size === 0) return [];

    const allowed = await this.prisma.providerAcl.findMany({
      where: { friendId: askingUserId, providerId: { in: [...mutuals] } },
      select: { providerId: true },
    });
    const allowedSet = new Set(allowed.map((a) => a.providerId));
    if (allowedSet.size === 0) return [];

    return this.prisma.providerRegistration.findMany({
      where: {
        userId: { in: [...allowedSet] },
        lastSeenAt: { gte: since },
        attested: true,
        ...(opts.modelId ? { modelId: opts.modelId } : {}),
        ...(opts.task ? { task: opts.task } : {}),
      },
      select: {
        userId: true,
        deviceId: true,
        modelId: true,
        task: true,
        networkAddr: true,
        noisePubkey: true,
        modelDigest: true,
        weightDigest: true,
        lastSeenAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
