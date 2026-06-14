/// <reference types="multer" />
import { Controller, Get, Post, Param, Req, Res, BadRequestException, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { DownloadsService } from './downloads.service';
import { Request, Response } from 'express';
import { AdminKeyGuard } from '../common/admin-key.guard';

const APP_PLATFORMS = ['linux', 'macos', 'windows'] as const;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

@Controller()
export class DownloadsController {
  constructor(private downloads: DownloadsService) {}

  @SkipThrottle()
  @Post('admin/app/upload')
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @UseGuards(AdminKeyGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadApp(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    const { platform, version } = req.body as { platform?: string; version?: string };
    if (!platform || !APP_PLATFORMS.includes(platform as any))
      throw new BadRequestException(`platform must be one of: ${APP_PLATFORMS.join(', ')}`);
    if (!version || !VERSION_RE.test(version)) throw new BadRequestException('version must follow semver');
    if (!file) throw new BadRequestException('file is required');
    const result = await this.downloads.uploadAppRelease(
      platform, version, file.originalname, file.buffer,
    );
    res.json({ ok: true, platform, version, filename: file.originalname, ...result });
  }

  @Get('downloads/app')
  async listApps() {
    return this.downloads.listAppReleases();
  }

  @Get('downloads/app/:platform')
  async downloadApp(@Param('platform') platform: string, @Res() res: Response) {
    if (!APP_PLATFORMS.includes(platform as any))
      throw new BadRequestException(`platform must be one of: ${APP_PLATFORMS.join(', ')}`);
    const release = await this.downloads.getAppRelease(platform);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${release.filename}"`,
      'Content-Length': release.size.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'X-SHA256': release.sha256,
    });
    res.send(release.data);
  }
}
