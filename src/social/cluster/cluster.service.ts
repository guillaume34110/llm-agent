import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const CLUSTER_TTL_MS = 72 * 60 * 60 * 1000;
const MIN_CONVERGING_REPLIES = 3;
const MAX_CLUSTER_SIZE = 12;

// Per-mode predicates: which reply answers count as "converging" (positive intent).
function isConverging(mode: string, answer: any): boolean {
  if (!answer || typeof answer !== 'object') return false;
  switch (mode) {
    case 'find_collab':
      return typeof answer.interest === 'number' && answer.interest >= 0.6;
    case 'find_expertise':
      return answer.knows === true;
    case 'announce_project':
      return answer.role_open === true;
    case 'rfc':
      return answer.stance === 'agree';
    default:
      return false;
  }
}

@Injectable()
export class ClusterService {
  private readonly logger = new Logger(ClusterService.name);
  constructor(private prisma: PrismaService) {}

  // Called by cron; idempotent. Emits a ClusterDraft when ≥N converging replies on a post
  // and no live draft already exists for it.
  async maybeEmitForPost(postId: string) {
    const existing = await this.prisma.clusterDraft.findFirst({
      where: { postId, status: 'pending' },
      select: { id: true },
    });
    if (existing) return null;

    const post = await this.prisma.wallPost.findUnique({ where: { id: postId } });
    if (!post) return null;

    const replies = await this.prisma.wallReply.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      take: MAX_CLUSTER_SIZE * 2,
    });
    const converging = replies.filter(r => isConverging(post.mode, r.answer));
    if (converging.length < MIN_CONVERGING_REPLIES) return null;

    const memberIds = new Set<string>([post.authorId, ...converging.slice(0, MAX_CLUSTER_SIZE - 1).map(r => r.responderId)]);
    const draft = await this.prisma.clusterDraft.create({
      data: {
        postId,
        expiresAt: new Date(Date.now() + CLUSTER_TTL_MS),
        members: {
          create: [...memberIds].map(userId => ({ userId, vote: userId === post.authorId ? 'yes' : 'pending' })),
        },
      },
      include: { members: true },
    });
    this.logger.log(`emitted cluster ${draft.id} for post ${postId} (${memberIds.size} members)`);
    return draft;
  }

  async listForUser(userId: string) {
    return this.prisma.clusterDraft.findMany({
      where: {
        status: 'pending',
        expiresAt: { gt: new Date() },
        members: { some: { userId } },
      },
      include: { members: true },
      orderBy: { proposedAt: 'desc' },
    });
  }

  async vote(userId: string, clusterId: string, vote: 'yes' | 'no') {
    if (vote !== 'yes' && vote !== 'no') throw new BadRequestException('bad vote');
    const member = await this.prisma.clusterMember.findUnique({
      where: { clusterId_userId: { clusterId, userId } },
    });
    if (!member) throw new ForbiddenException('not a member');
    const draft = await this.prisma.clusterDraft.findUnique({ where: { id: clusterId } });
    if (!draft || draft.status !== 'pending' || draft.expiresAt <= new Date()) {
      throw new ForbiddenException('cluster closed');
    }
    await this.prisma.clusterMember.update({
      where: { clusterId_userId: { clusterId, userId } },
      data: { vote, votedAt: new Date() },
    });
    return this.promoteIfMajority(clusterId);
  }

  // Promote to ProjectRoom when majority "yes" AND no "no" votes (one nay vetoes).
  private async promoteIfMajority(clusterId: string) {
    const draft = await this.prisma.clusterDraft.findUnique({
      where: { id: clusterId },
      include: { members: true },
    });
    if (!draft || draft.status !== 'pending') return draft;
    const total = draft.members.length;
    const yes = draft.members.filter(m => m.vote === 'yes').length;
    const no = draft.members.filter(m => m.vote === 'no').length;
    if (no > 0) {
      await this.prisma.clusterDraft.updateMany({
        where: { id: clusterId, status: 'pending' },
        data: { status: 'rejected' },
      });
      return { ...draft, status: 'rejected' as const };
    }
    if (yes < Math.ceil((total * 2) / 3)) return draft;

    const acceptedMembers = draft.members.filter(m => m.vote === 'yes');
    const post = await this.prisma.wallPost.findUnique({ where: { id: draft.postId }, select: { tag: true, mode: true } });
    const name = `room:${post?.tag ?? 'cluster'}:${draft.id.slice(0, 8)}`;
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.projectRoom.create({
        data: {
          name,
          createdFromClusterId: draft.id,
          members: {
            create: acceptedMembers.map(m => ({ userId: m.userId, role: 'contributor' })),
          },
        },
        include: { members: true },
      });
      await tx.clusterDraft.update({
        where: { id: clusterId },
        data: { status: 'accepted', resultingRoomId: room.id },
      });
      return { promoted: true, room };
    });
  }

  // Sweep: scan recent posts and try to emit drafts. Cheap: index on (tag, createdAt) caps fan.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepConvergingPosts() {
    const recent = await this.prisma.wallPost.findMany({
      where: { expiresAt: { gt: new Date() } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    let emitted = 0;
    for (const p of recent) {
      try {
        const r = await this.maybeEmitForPost(p.id);
        if (r) emitted++;
      } catch (e: any) {
        this.logger.warn(`emit ${p.id} failed: ${e?.message ?? e}`);
      }
    }
    if (emitted > 0) this.logger.log(`emitted ${emitted} cluster drafts`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expireDrafts() {
    const res = await this.prisma.clusterDraft.updateMany({
      where: { status: 'pending', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
    if (res.count > 0) this.logger.log(`expired ${res.count} cluster drafts`);
  }
}
