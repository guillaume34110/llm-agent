// AgentCert registry. Used by inquiry/match flows to verify that the
// runtime that produced a signature has not been revoked. Revocation is
// the moderation hammer in the anonymized world: we can't ban a userId we
// don't know, but we can refuse any payload signed by a fingerprint we've
// flagged.

import { createHash, verify as edVerify } from 'crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentCertService {
  constructor(private prisma: PrismaService) {}

  fingerprint(pubkey: Buffer): string {
    return createHash('sha256').update(pubkey).digest('hex');
  }

  // Registers or refreshes a cert. Idempotent on fingerprint.
  async register(pubkey: Buffer) {
    const fp = this.fingerprint(pubkey);
    await this.prisma.agentCert.upsert({
      where: { fingerprint: fp },
      create: { fingerprint: fp, pubkey },
      update: {},
    });
    return fp;
  }

  // Verifies an Ed25519 signature against a pubkey, and rejects revoked
  // certs. Called from inquiry.respond + match turn handlers when sig is
  // present. Throws if revoked; returns true/false otherwise.
  async verifySig(pubkey: Buffer, payload: Buffer, sig: Buffer): Promise<boolean> {
    const fp = this.fingerprint(pubkey);
    const cert = await this.prisma.agentCert.findUnique({ where: { fingerprint: fp } });
    if (cert?.status === 'revoked') {
      throw new ForbiddenException('agent runtime revoked');
    }
    if (!cert) {
      // Lazy register on first sighting so we can revoke later if needed.
      await this.register(pubkey);
    }
    try {
      // Ed25519 takes algorithm=null in node's crypto.verify
      return edVerify(null, payload, { key: pubkey, format: 'der', type: 'spki' } as any, sig);
    } catch {
      // Best-effort: not all callers will have a DER-wrapped key, raw pubkey
      // path below.
      try {
        return edVerify(
          null,
          payload,
          // @ts-ignore - KeyObject accepts raw via createPublicKey, but
          // callers passing a raw 32-byte key should wrap it themselves.
          pubkey,
          sig,
        );
      } catch {
        return false;
      }
    }
  }

  async revoke(fingerprint: string, reason: string) {
    const res = await this.prisma.agentCert.updateMany({
      where: { fingerprint, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date(), revokedReason: reason.slice(0, 200) },
    });
    return { ok: res.count > 0 };
  }

  async incrementSignal(fingerprint: string) {
    await this.prisma.agentCert.updateMany({
      where: { fingerprint },
      data: { signalCount: { increment: 1 } },
    });
  }

  async isRevoked(fingerprint: string): Promise<boolean> {
    const c = await this.prisma.agentCert.findUnique({ where: { fingerprint } });
    return c?.status === 'revoked';
  }
}
