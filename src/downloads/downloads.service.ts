import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class DownloadsService {
  constructor(private prisma: PrismaService) {}

  async uploadAppRelease(platform: string, version: string, filename: string, buffer: Buffer) {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const size = buffer.length;
    await this.prisma.appRelease.upsert({
      where: { platform },
      create: { platform, version, filename, data: buffer, sha256, size },
      update: { version, filename, data: buffer, sha256, size },
    });
    return { sha256, size };
  }

  async getAppRelease(platform: string) {
    const release = await this.prisma.appRelease.findUnique({ where: { platform } });
    if (!release) throw new NotFoundException(`No release for platform: ${platform}`);
    return release;
  }

  async listAppReleases() {
    return this.prisma.appRelease.findMany({
      select: { platform: true, version: true, filename: true, size: true, sha256: true, updatedAt: true },
      orderBy: { platform: 'asc' },
    });
  }
}
