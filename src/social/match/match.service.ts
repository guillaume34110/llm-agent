import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { AgentCertService } from '../agent-cert.service';

const SESSION_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_TURNS = 5;
const MAX_CIPHERTEXT_BYTES = 16 * 1024; // 16 KiB per turn ought to be plenty
const MAX_REPORT_BYTES = 64 * 1024;
const MAX_SIG_BYTES = 256;

function deriveAnonId(sessionId: string, userId: string, salt: Buffer): string {
  // Per-session HMAC-SHA256 (truncated to 16 bytes). Equivalent to HKDF-Extract
  // without Expand — sufficient because we only emit one tag per (session,user)
  // and salt is per-session random, so anonIds cannot be correlated across sessions.
  const ikm = Buffer.from(`${sessionId}|${userId}`, 'utf8');
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return prk.subarray(0, 16).toString('hex');
}

@Injectable()
export class MatchService {
  constructor(
    private prisma: PrismaService,
    private moderation: ModerationService,
    private agentCert: AgentCertService,
  ) {}

  // Initiator escalates a "yes" InquiryResponse into a multi-turn session.
  async start(initiatorId: string, inquiryId: string, responderId: string) {
    const inq = await this.prisma.inquiryRequest.findUnique({ where: { id: inquiryId } });
    if (!inq) throw new NotFoundException('inquiry not found');
    if (inq.initiatorId !== initiatorId) throw new ForbiddenException('not inquiry owner');
    if (inq.status !== 'open' || inq.expiresAt <= new Date()) {
      throw new ForbiddenException('inquiry closed');
    }
    if (responderId === initiatorId) throw new BadRequestException('cannot match self');

    if (await this.moderation.isBlockedPair(initiatorId, responderId)) {
      throw new ForbiddenException('blocked');
    }

    const resp = await this.prisma.inquiryResponse.findUnique({
      where: { inquiryId_responderId: { inquiryId, responderId } },
    });
    if (!resp) throw new NotFoundException('responder has not answered');
    if (!resp.guardPassed) throw new ForbiddenException('responder failed guard');

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    let session;
    try {
      session = await this.prisma.matchSession.create({
        data: { inquiryId, initiatorId, responderId, expiresAt },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const existing = await this.prisma.matchSession.findUnique({
          where: { inquiryId_responderId: { inquiryId, responderId } },
        });
        if (existing) return existing;
      }
      throw e;
    }
    // Mint anonymized intermediate IDs (S5). Each side will fetch its own
    // anonId via getMyAnonId — they only ever learn the other party's anonId.
    const salt = randomBytes(16);
    await this.prisma.$transaction([
      this.prisma.matchAnonId.create({
        data: {
          sessionId: session.id,
          userId: initiatorId,
          anonId: deriveAnonId(session.id, initiatorId, salt),
          roleA: true,
          expiresAt,
        },
      }),
      this.prisma.matchAnonId.create({
        data: {
          sessionId: session.id,
          userId: responderId,
          anonId: deriveAnonId(session.id, responderId, salt),
          roleA: false,
          expiresAt,
        },
      }),
    ]);
    return session;
  }

  // Returns my anon id + the peer's anon id for a session. Never leaks the
  // peer's real userId.
  async anonView(userId: string, sessionId: string) {
    const rows = await this.prisma.matchAnonId.findMany({ where: { sessionId } });
    if (rows.length === 0) throw new NotFoundException('session not found');
    const mine = rows.find((r) => r.userId === userId);
    if (!mine) throw new ForbiddenException('not a participant');
    const peer = rows.find((r) => r.userId !== userId);
    return {
      sessionId,
      myAnonId: mine.anonId,
      peerAnonId: peer?.anonId ?? null,
      roleA: mine.roleA,
    };
  }

  async listMine(userId: string) {
    const rows = await this.prisma.matchSession.findMany({
      where: {
        OR: [{ initiatorId: userId }, { responderId: userId }],
        status: 'open',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    // Strip peer userIds to preserve mutual anonymity. Caller uses anonView for IDs.
    return rows.map(s => {
      const isInitiator = s.initiatorId === userId;
      const { initiatorId, responderId, ...safe } = s;
      return { ...safe, roleA: isInitiator };
    });
  }

  async get(userId: string, sessionId: string) {
    const s = await this.prisma.matchSession.findUnique({
      where: { id: sessionId },
      include: { turns: { orderBy: { turnIndex: 'asc' } } },
    });
    if (!s) throw new NotFoundException('session not found');
    if (s.initiatorId !== userId && s.responderId !== userId) {
      throw new ForbiddenException('not a participant');
    }
    // Strip peer userIds to preserve mutual anonymity (S5 invariant).
    const isInitiator = s.initiatorId === userId;
    const { initiatorId, responderId, ...safe } = s;
    return { ...safe, roleA: isInitiator };
  }

  async appendTurn(userId: string, sessionId: string, body: { ciphertext: string; agentPubkey?: string; agentSig?: string }) {
    if (typeof body.ciphertext !== 'string' || body.ciphertext.length === 0) {
      throw new BadRequestException('ciphertext required');
    }
    const bytes = Buffer.from(body.ciphertext, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_CIPHERTEXT_BYTES) {
      throw new BadRequestException('ciphertext size out of range');
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

    const s = await this.prisma.matchSession.findUnique({
      where: { id: sessionId },
      include: { turns: { orderBy: { turnIndex: 'asc' } } },
    });
    if (!s) throw new NotFoundException('session not found');
    if (s.initiatorId !== userId && s.responderId !== userId) {
      throw new ForbiddenException('not a participant');
    }
    if (s.status !== 'open' || s.expiresAt <= new Date()) {
      throw new ForbiddenException('session closed');
    }
    if (s.turns.length >= MAX_TURNS) {
      throw new ForbiddenException('turn cap reached');
    }

    const turnIndex = s.turns.length;
    const expectedRoleA = turnIndex % 2 === 0;
    const isInitiator = s.initiatorId === userId;
    if (expectedRoleA !== isInitiator) {
      throw new ForbiddenException('not your turn');
    }

    try {
      return await this.prisma.matchTurn.create({
        data: {
          sessionId,
          turnIndex,
          roleA: isInitiator,
          ciphertext: bytes,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ForbiddenException('turn race');
      throw e;
    }
  }

  async close(userId: string, sessionId: string, reason: string) {
    const allowed = new Set(['completed', 'rejected', 'timeout', 'abort']);
    if (!allowed.has(reason)) throw new BadRequestException('bad reason');
    const s = await this.prisma.matchSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('session not found');
    if (s.initiatorId !== userId && s.responderId !== userId) {
      throw new ForbiddenException('not a participant');
    }
    const res = await this.prisma.matchSession.updateMany({
      where: { id: sessionId, status: 'open' },
      data: { status: 'closed', closedAt: new Date(), closedReason: reason },
    });
    if (reason !== 'completed') {
      // Atomic purge of anon mapping when the session ends without a friend
      // promotion — neither party should be able to correlate later.
      await this.prisma.matchAnonId.deleteMany({ where: { sessionId } });
    }
    return { ok: res.count > 0 };
  }

  // S4 — initiator posts the final report ciphertext + agent signature.
  async submitReport(userId: string, sessionId: string, body: { ciphertext: string; agentSigA: string }) {
    const s = await this.prisma.matchSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('session not found');
    if (s.initiatorId !== userId) throw new ForbiddenException('only initiator can post report');
    const ct = Buffer.from(body.ciphertext, 'base64');
    const sig = Buffer.from(body.agentSigA, 'base64');
    if (ct.length === 0 || ct.length > MAX_REPORT_BYTES) throw new BadRequestException('bad ciphertext size');
    if (sig.length === 0 || sig.length > MAX_SIG_BYTES) throw new BadRequestException('bad agentSigA size');
    try {
      return await this.prisma.matchReport.create({
        data: { sessionId, ciphertext: ct, agentSigA: sig },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ForbiddenException('report already submitted');
      throw e;
    }
  }

  async ackReport(userId: string, sessionId: string, agentSigB: string) {
    const s = await this.prisma.matchSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('session not found');
    if (s.responderId !== userId) throw new ForbiddenException('only responder can ack');
    const sig = Buffer.from(agentSigB, 'base64');
    if (sig.length === 0 || sig.length > MAX_SIG_BYTES) throw new BadRequestException('bad agentSigB size');
    const res = await this.prisma.matchReport.updateMany({
      where: { sessionId, agentSigB: null },
      data: { agentSigB: sig, ackedAt: new Date() },
    });
    if (res.count === 0) throw new ForbiddenException('no pending report');
    return { ok: true };
  }

  async getReport(userId: string, sessionId: string) {
    const s = await this.prisma.matchSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('session not found');
    if (s.initiatorId !== userId && s.responderId !== userId) throw new ForbiddenException('not a participant');
    const r = await this.prisma.matchReport.findUnique({ where: { sessionId } });
    if (!r) throw new NotFoundException('report not found');
    return {
      id: r.id,
      sessionId: r.sessionId,
      ciphertext: r.ciphertext.toString('base64'),
      agentSigA: r.agentSigA.toString('base64'),
      agentSigB: r.agentSigB ? r.agentSigB.toString('base64') : null,
      ackedAt: r.ackedAt,
      createdAt: r.createdAt,
    };
  }

  // S6 — each side records accept/reject. When both accept, promote to
  // Friendship and purge anon mapping. When either rejects, close + purge.
  async consent(userId: string, sessionId: string, decision: 'accept' | 'reject') {
    if (decision !== 'accept' && decision !== 'reject') throw new BadRequestException('bad decision');
    const s = await this.prisma.matchSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('session not found');
    if (s.initiatorId !== userId && s.responderId !== userId) throw new ForbiddenException('not a participant');

    try {
      await this.prisma.matchConsent.create({ data: { sessionId, userId, decision } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ForbiddenException('already consented');
      throw e;
    }

    if (decision === 'reject') {
      await this.prisma.matchSession.updateMany({
        where: { id: sessionId, status: 'open' },
        data: { status: 'closed', closedAt: new Date(), closedReason: 'rejected' },
      });
      await this.prisma.matchAnonId.deleteMany({ where: { sessionId } });
      return { ok: true, friended: false };
    }

    const both = await this.prisma.matchConsent.findMany({ where: { sessionId, decision: 'accept' } });
    if (both.length >= 2) {
      // Promote: create symmetric Friendship rows + purge anon mapping.
      await this.prisma.$transaction([
        this.prisma.friendship.upsert({
          where: { userId_friendId: { userId: s.initiatorId, friendId: s.responderId } },
          create: { userId: s.initiatorId, friendId: s.responderId, viaSessionId: sessionId },
          update: {},
        }),
        this.prisma.friendship.upsert({
          where: { userId_friendId: { userId: s.responderId, friendId: s.initiatorId } },
          create: { userId: s.responderId, friendId: s.initiatorId, viaSessionId: sessionId },
          update: {},
        }),
        this.prisma.matchSession.updateMany({
          where: { id: sessionId, status: 'open' },
          data: { status: 'closed', closedAt: new Date(), closedReason: 'completed' },
        }),
        this.prisma.matchAnonId.deleteMany({ where: { sessionId } }),
      ]);
      return { ok: true, friended: true };
    }
    return { ok: true, friended: false };
  }
}
