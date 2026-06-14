import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createVerify, createHash, createPublicKey, verify as cryptoVerify } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';

// Pinned Progsoft signing pubkey (PEM, set at deploy time). The signed Provider
// runtime ships with the binary hash; we verify the signature here.
// Format: PEM SPKI Ed25519 / RSA. Empty disables attestation in dev only.
const PROGSOFT_PUBKEY_PEM = (process.env.PROGSOFT_RUNTIME_PUBKEY_PEM || '').replace(/\\n/g, '\n');

// How long an attestation stays valid before the provider must re-attest.
const ATTEST_TTL_MS = 24 * 60 * 60 * 1000;

interface AttestInput {
  modelId: string;
  runtimeHash: string;
  runtimeSig: string; // base64
  deviceId?: string;
}

interface SampleInput {
  providerId: string;
  modelId?: string;
  canary: string;
  response: string;
}

@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);

  constructor(private prisma: PrismaService, private presence: PresenceService) {}

  async attest(userId: string, input: AttestInput) {
    if (!input.runtimeHash || !input.runtimeSig || !input.modelId) {
      throw new BadRequestException('runtimeHash, runtimeSig, modelId required');
    }
    const ok = this.verifySignature(input.runtimeHash, input.runtimeSig);
    if (!ok) {
      this.logger.warn(`Attestation signature rejected for userId=${userId}`);
      throw new BadRequestException('invalid runtime signature');
    }
    const expiresAt = new Date(Date.now() + ATTEST_TTL_MS);
    const row = await this.prisma.providerAttestation.create({
      data: {
        userId,
        runtimeHash: input.runtimeHash,
        runtimeSig: input.runtimeSig,
        expiresAt,
      },
    });
    await this.presence.setAttested(userId, input.modelId, true, input.deviceId);
    return { id: row.id, expiresAt };
  }

  async recordSample(input: SampleInput) {
    if (!input.providerId || !input.canary || !input.response) {
      throw new BadRequestException('providerId, canary, response required');
    }
    const canaryHash = createHash('sha256').update(input.canary).digest('hex');
    const responseHash = createHash('sha256').update(input.response).digest('hex');
    // Validity rule: if an operator-curated reference exists for (canary, model)
    // we require an exact responseHash match. Otherwise fall back to a length
    // sanity gate — majority-vote drift detection still demotes outliers.
    let valid = false;
    if (input.modelId) {
      const ref = await this.prisma.canaryReference.findUnique({
        where: { canaryHash_modelId: { canaryHash, modelId: input.modelId } },
      });
      if (ref) {
        valid = ref.responseHash === responseHash;
      } else {
        valid = input.response.trim().length >= 16;
      }
    } else {
      valid = input.response.trim().length >= 16;
    }
    const row = await this.prisma.attestationSample.create({
      data: {
        providerId: input.providerId,
        modelId: input.modelId ?? null,
        canaryHash,
        responseHash,
        valid,
      },
    });
    return { id: row.id, valid, responseHash };
  }

  private verifySignature(payload: string, signatureB64: string): boolean {
    // Dev escape hatch: empty pubkey disables verification (logs a warning).
    if (!PROGSOFT_PUBKEY_PEM) {
      this.logger.warn('PROGSOFT_RUNTIME_PUBKEY_PEM unset — attestation accepts all signatures (dev only)');
      return true;
    }
    try {
      const sig = Buffer.from(signatureB64, 'base64');
      const key = createPublicKey(PROGSOFT_PUBKEY_PEM);
      // Ed25519 has built-in hashing — Node's createVerify('SHA256') doesn't
      // work with it. Detect Ed25519 keys and use crypto.verify directly;
      // fall back to RSA/ECDSA-SHA256 verify for other key types.
      if (key.asymmetricKeyType === 'ed25519') {
        return cryptoVerify(null, Buffer.from(payload), key, sig);
      }
      const v = createVerify('SHA256');
      v.update(payload);
      v.end();
      return v.verify(key, sig);
    } catch (err) {
      this.logger.error('Signature verification threw: ' + (err as Error).message);
      return false;
    }
  }
}
