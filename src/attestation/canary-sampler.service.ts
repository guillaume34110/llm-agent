import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AttestationService } from './attestation.service';
import { PresenceService } from '../presence/presence.service';

// Public canary prompts. Their outputs are not secret — multiple providers
// running the same model should produce similar responses (temp=0). The server
// stores each sample; drift detection (majority vote per model+prompt) demotes
// providers whose hash disagrees with the consensus.
const CANARY_PROMPTS = [
  'Reply with the single word: pong.',
  'List the first five prime numbers separated by commas.',
  'In one short sentence, what does HTTP stand for?',
];

const ONLINE_WINDOW_MS = 90_000;
const QUORUM = 3;

interface SampleOutcome {
  providerId: string;
  deviceId: string;
  modelId: string;
  responseHash: string;
}

@Injectable()
export class CanarySamplerService {
  private readonly logger = new Logger(CanarySamplerService.name);

  constructor(
    private prisma: PrismaService,
    private attestation: AttestationService,
    private presence: PresenceService,
  ) {}

  private readonly canarySecret = process.env.PROGSOFT_CANARY_SECRET ?? '';

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sampleOnlineProviders() {
    if (process.env.PROGSOFT_DISABLE_CANARY === '1') return;
    if (!this.canarySecret) {
      this.logger.warn('PROGSOFT_CANARY_SECRET not set — skipping canary sampling');
      return;
    }
    const since = new Date(Date.now() - ONLINE_WINDOW_MS);
    const providers = await this.prisma.providerRegistration.findMany({
      where: { lastSeenAt: { gte: since }, attested: true },
      take: 64,
    });
    if (providers.length === 0) return;
    const prompt = CANARY_PROMPTS[Math.floor(Math.random() * CANARY_PROMPTS.length)];

    const results = await Promise.allSettled(
      providers.map((p) => this.sampleOne(p.userId, p.deviceId, p.modelId, p.networkAddr, prompt)),
    );
    const ok: SampleOutcome[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) ok.push(r.value);
    }
    await this.detectDrift(prompt, ok);
  }

  private async sampleOne(
    providerUserId: string,
    deviceId: string,
    modelId: string,
    networkAddr: string,
    prompt: string,
  ): Promise<SampleOutcome | null> {
    try {
      const url = `${networkAddr.replace(/\/+$/, '')}/attestation/canary`;
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 15_000);
      const token = createHmac('sha256', this.canarySecret).update(prompt).digest('hex');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Canary-Token': token },
        body: JSON.stringify({ prompt }),
        signal: ctl.signal,
      });
      clearTimeout(to);
      if (!res.ok) {
        this.logger.warn(`canary ${providerUserId} HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { response?: string; model?: string };
      const response = body.response ?? '';
      const sample = await this.attestation.recordSample({
        providerId: providerUserId,
        modelId,
        canary: prompt,
        response,
      });
      return { providerId: providerUserId, deviceId, modelId, responseHash: sample.responseHash };
    } catch (err) {
      this.logger.warn(`canary ${providerUserId} failed: ${(err as Error).message}`);
      return null;
    }
  }

  // Majority vote per (modelId, prompt). Providers in the minority are demoted
  // (attested=false). They can re-attest by posting a fresh runtime hash.
  private async detectDrift(prompt: string, samples: SampleOutcome[]) {
    const canaryHash = createHash('sha256').update(prompt).digest('hex');
    const byModel = new Map<string, SampleOutcome[]>();
    for (const s of samples) {
      const arr = byModel.get(s.modelId) ?? [];
      arr.push(s);
      byModel.set(s.modelId, arr);
    }
    for (const [modelId, group] of byModel) {
      if (group.length < QUORUM) continue;
      const counts = new Map<string, number>();
      for (const s of group) counts.set(s.responseHash, (counts.get(s.responseHash) ?? 0) + 1);
      let majorityHash = '';
      let majorityCount = 0;
      for (const [h, c] of counts) {
        if (c > majorityCount) { majorityHash = h; majorityCount = c; }
      }
      if (majorityCount * 2 <= group.length) continue;
      const outliers = group.filter((s) => s.responseHash !== majorityHash);
      await Promise.all(outliers.map((o) => {
        this.logger.warn(
          `drift: provider=${o.providerId} device=${o.deviceId} model=${modelId} canary=${canaryHash.slice(0, 12)} ` +
          `majority=${majorityHash.slice(0, 12)} got=${o.responseHash.slice(0, 12)} — demoting`,
        );
        return this.presence.setAttested(o.providerId, modelId, false, o.deviceId);
      }));
    }
  }
}
