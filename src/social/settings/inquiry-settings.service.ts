import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidTag, MAX_USER_TAGS } from '../tags';

const ALL_INQUIRY_MODES = new Set([
  'find_expertise', 'find_mate', 'find_worker', 'find_opinion', 'find_review', 'find_collab',
]);
const MAX_PER_DAY_MAX = 200;

export interface InquirySettingsInput {
  acceptInquiries?: boolean;
  acceptedModes?: string[];
  acceptedTags?: string[];
  maxPerDay?: number;
}

@Injectable()
export class InquirySettingsService {
  constructor(private prisma: PrismaService) {}

  async get(userId: string) {
    const existing = await this.prisma.userInquirySettings.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.userInquirySettings.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async update(userId: string, input: InquirySettingsInput) {
    const data: any = {};
    if (input.acceptInquiries !== undefined) data.acceptInquiries = !!input.acceptInquiries;

    if (input.acceptedModes !== undefined) {
      if (!Array.isArray(input.acceptedModes)) throw new BadRequestException('acceptedModes must be array');
      const modes = [...new Set(input.acceptedModes)];
      for (const m of modes) {
        if (!ALL_INQUIRY_MODES.has(m)) throw new BadRequestException(`unknown mode: ${m}`);
      }
      data.acceptedModes = modes;
    }

    if (input.acceptedTags !== undefined) {
      if (!Array.isArray(input.acceptedTags)) throw new BadRequestException('acceptedTags must be array');
      const tags = [...new Set(input.acceptedTags)];
      if (tags.length > MAX_USER_TAGS) throw new BadRequestException(`max ${MAX_USER_TAGS} tags`);
      for (const t of tags) {
        if (typeof t !== 'string' || !isValidTag(t)) throw new BadRequestException(`unknown tag: ${t}`);
      }
      data.acceptedTags = tags;
    }

    if (input.maxPerDay !== undefined) {
      const n = Number(input.maxPerDay);
      if (!Number.isInteger(n) || n < 0 || n > MAX_PER_DAY_MAX) {
        throw new BadRequestException(`maxPerDay must be 0..${MAX_PER_DAY_MAX}`);
      }
      data.maxPerDay = n;
    }

    return this.prisma.userInquirySettings.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  // Hot path for inquiry fanout — returns candidates accepting `mode` with any tag overlap.
  async candidatesForMode(mode: string, tags: string[], excludeUserIds: Set<string>, limit: number) {
    if (!ALL_INQUIRY_MODES.has(mode)) return [];
    const rows = await this.prisma.userInquirySettings.findMany({
      where: {
        acceptInquiries: true,
        acceptedModes: { has: mode },
        acceptedTags: { hasSome: tags },
      },
      select: { userId: true, maxPerDay: true, responseRate30d: true },
      take: limit * 4,
    });
    return rows.filter(r => !excludeUserIds.has(r.userId)).slice(0, limit);
  }

  async accepts(userId: string, mode: string, tags: string[]): Promise<boolean> {
    const s = await this.prisma.userInquirySettings.findUnique({
      where: { userId },
      select: { acceptInquiries: true, acceptedModes: true, acceptedTags: true },
    });
    if (!s || !s.acceptInquiries) return false;
    if (!s.acceptedModes.includes(mode)) return false;
    return tags.some(t => s.acceptedTags.includes(t));
  }
}
