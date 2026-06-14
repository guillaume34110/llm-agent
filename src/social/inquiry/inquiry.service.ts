import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeTags } from '../tags';
import {
  validateInquiryAnswer,
  validateRationale,
  type InquiryMode,
} from '../schemas';
import { ModerationService } from '../moderation/moderation.service';
import { InquirySettingsService } from '../settings/inquiry-settings.service';
import { AgentCertService } from '../agent-cert.service';

const INQUIRY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FANOUT = 25;
const DAILY_BROADCAST_LIMIT = 10;

export interface BroadcastInput {
  mode: InquiryMode;
  tags: string[];
  fanout?: number;
  questionDigest: string; // sha256 hex of the client-side question text (server never sees question)
}

@Injectable()
export class InquiryService {
  constructor(
    private prisma: PrismaService,
    private settings: InquirySettingsService,
    private moderation: ModerationService,
    private agentCert: AgentCertService,
  ) {}

  async broadcast(initiatorId: string, input: BroadcastInput) {
    const tags = sanitizeTags(input.tags, 5);
    if (tags.length === 0) throw new BadRequestException('at least one valid tag required');
    if (typeof input.questionDigest !== 'string' || !/^[0-9a-f]{64}$/.test(input.questionDigest)) {
      throw new BadRequestException('bad questionDigest');
    }
    const fanout = Math.min(MAX_FANOUT, Math.max(1, input.fanout ?? 5));

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.inquiryRequest.count({
      where: { initiatorId, createdAt: { gte: since } },
    });
    if (recent >= DAILY_BROADCAST_LIMIT) {
      throw new ForbiddenException('daily inquiry limit reached');
    }

    const queryHash = createHash('sha256')
      .update(`${input.mode}|${tags.sort().join(',')}|${input.questionDigest}`)
      .digest('hex');

    const dupe = await this.prisma.inquiryRequest.findFirst({
      where: { initiatorId, queryHash, status: 'open' },
      select: { id: true },
    });
    if (dupe) throw new ForbiddenException('duplicate inquiry already open');

    const blocked = await this.moderation.pairwiseBlocked(initiatorId);
    blocked.add(initiatorId);
    const candidates = await this.settings.candidatesForMode(input.mode, tags, blocked, fanout);

    const expiresAt = new Date(Date.now() + INQUIRY_TTL_MS);

    const req = await this.prisma.inquiryRequest.create({
      data: {
        initiatorId,
        mode: input.mode,
        queryHash,
        filters: { tags },
        fanout: candidates.length,
        costCents: 0,
        expiresAt,
      },
    });
    return { id: req.id, fanout: candidates.length, expiresAt, recipients: candidates.map(c => c.userId) };
  }

  async listOpenForResponder(responderId: string) {
    const blocked = await this.moderation.pairwiseBlocked(responderId);
    const now = new Date();
    const open = await this.prisma.inquiryRequest.findMany({
      where: { status: 'open', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (open.length === 0) return [];
    const candidates = open.filter(r => !blocked.has(r.initiatorId));
    if (candidates.length === 0) return [];
    const responded = await this.prisma.inquiryResponse.findMany({
      where: { responderId, inquiryId: { in: candidates.map(c => c.id) } },
      select: { inquiryId: true },
    });
    const respondedSet = new Set(responded.map(r => r.inquiryId));
    const filtered = [];
    for (const r of candidates) {
      if (respondedSet.has(r.id)) continue;
      const tags = Array.isArray((r.filters as any)?.tags) ? (r.filters as any).tags as string[] : [];
      if (!(await this.settings.accepts(responderId, r.mode, tags))) continue;
      // Strip initiatorId + costCents to preserve initiator anonymity pre-consent.
      const { initiatorId, costCents, ...safe } = r;
      filtered.push(safe);
    }
    return filtered;
  }

  async respond(responderId: string, inquiryId: string, body: {
    answer: unknown;
    rationaleEnc?: string;
    guardPassed: boolean;
    agentSig?: string;
    agentPubkey?: string;
  }) {
    // guardPassed is a client-side witness only — real enforcement lives provider-side
    // (Llama-Guard double-pass, fail-closed). Server cannot trust this flag.
    if (typeof body.guardPassed !== 'boolean') throw new BadRequestException('guardPassed required');

    const inq = await this.prisma.inquiryRequest.findUnique({ where: { id: inquiryId } });
    if (!inq) throw new NotFoundException('inquiry not found');
    if (inq.status !== 'open' || inq.expiresAt <= new Date()) throw new ForbiddenException('inquiry closed');
    if (inq.initiatorId === responderId) throw new ForbiddenException('cannot self-respond');

    if (await this.moderation.isBlockedPair(inq.initiatorId, responderId)) {
      throw new ForbiddenException('blocked');
    }

    const filters = inq.filters as any;
    const tags: string[] = Array.isArray(filters?.tags) ? filters.tags : [];
    if (!(await this.settings.accepts(responderId, inq.mode, tags))) {
      throw new ForbiddenException('not opted in for mode/tags');
    }

    const v = validateInquiryAnswer(inq.mode, body.answer);
    if (!v.ok) throw new BadRequestException(`bad answer: ${v.reason}`);

    const r = validateRationale(body.rationaleEnc);
    if (!r.ok) throw new BadRequestException('bad rationale');

    const agentSig = body.agentSig ? Buffer.from(body.agentSig, 'base64') : null;
    if (agentSig && (agentSig.length === 0 || agentSig.length > 256)) {
      throw new BadRequestException('bad agentSig');
    }

    if (body.agentPubkey) {
      const pubBytes = Buffer.from(body.agentPubkey, 'base64');
      if (pubBytes.length === 0 || pubBytes.length > 512) {
        throw new BadRequestException('bad agentPubkey');
      }
      const fp = this.agentCert.fingerprint(pubBytes);
      if (await this.agentCert.isRevoked(fp)) {
        throw new ForbiddenException('agent runtime revoked');
      }
      await this.agentCert.register(pubBytes);
    }

    try {
      return await this.prisma.inquiryResponse.create({
        data: {
          inquiryId,
          responderId,
          answer: body.answer as any,
          rationaleEnc: r.bytes ?? null,
          guardPassed: body.guardPassed,
          agentSig,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ForbiddenException('already responded');
      throw e;
    }
  }

  async getForInitiator(initiatorId: string, inquiryId: string) {
    const inq = await this.prisma.inquiryRequest.findUnique({
      where: { id: inquiryId },
      include: { responses: { orderBy: { createdAt: 'asc' } } },
    });
    if (!inq) throw new NotFoundException('inquiry not found');
    if (inq.initiatorId !== initiatorId) throw new ForbiddenException('not owner');
    return inq;
  }

  async close(initiatorId: string, inquiryId: string) {
    const res = await this.prisma.inquiryRequest.updateMany({
      where: { id: inquiryId, initiatorId, status: 'open' },
      data: { status: 'closed' },
    });
    if (res.count === 0) throw new NotFoundException('inquiry not found or not open');
    return { ok: true };
  }
}
