import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SocialService } from './social.service';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

class UpsertProfileDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$/)
  handle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  avatarCosmeticId?: string | null;
}

class CreateConversationDto {
  @IsString()
  @MinLength(4)
  @MaxLength(8 * 1024 * 1024)
  encryptedBlobB64!: string;
}

@Controller('social')
export class SocialController {
  constructor(private social: SocialService) {}

  // ── Public profile ───────────────────────────────────────────────────────
  @Get('profile/:handle')
  async getProfile(@Param('handle') handle: string) {
    return this.social.getProfileByHandle(handle);
  }

  @Get('me/profile')
  @UseGuards(JwtAuthGuard)
  async getOwnProfile(@Req() req: Request & { user: any }) {
    const userId = req.user.sub;
    return (await this.social.getOwnProfile(userId)) ?? { handle: null };
  }

  @Put('me/profile')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async upsertProfile(@Req() req: Request & { user: any }, @Body() body: UpsertProfileDto) {
    const userId = req.user.sub;
    return this.social.upsertProfile(userId, body);
  }

  @Delete('me/profile')
  @UseGuards(JwtAuthGuard)
  async deleteProfile(@Req() req: Request & { user: any }) {
    const userId = req.user.sub;
    return this.social.deleteProfile(userId);
  }

  // ── Shared conversation blobs ────────────────────────────────────────────
  // Client posts an opaque ciphertext. The decryption key lives in the URL
  // fragment (#key=…) on the recipient side — never sent to the server.
  @Post('conversations')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createConv(@Req() req: Request & { user: any }, @Body() body: CreateConversationDto) {
    const userId = req.user.sub;
    const b64 = body.encryptedBlobB64;
    // Strict base64 (no urlsafe, no whitespace). Buffer.from silently truncates garbage otherwise.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) {
      throw new BadRequestException('encryptedBlobB64 not valid base64');
    }
    const buf = Buffer.from(b64, 'base64');
    return this.social.createSharedConversation(userId, buf);
  }

  @Get('conversations/:id')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async getConv(@Param('id') id: string, @Res() res: Response) {
    const row = await this.social.getSharedConversation(id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Created-At', row.createdAt.toISOString());
    res.send(row.encryptedBlob);
  }

  @Delete('conversations/:id')
  @UseGuards(JwtAuthGuard)
  async deleteConv(@Req() req: Request & { user: any }, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.social.deleteSharedConversation(userId, id);
  }
}
