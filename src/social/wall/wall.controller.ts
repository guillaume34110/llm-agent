import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { IsBoolean, IsDefined, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WallService } from './wall.service';
import type { WallMode } from '../schemas';

class CreateWallPostDto {
  @IsString()
  @MaxLength(64)
  tag!: string;

  @IsString()
  @IsIn(['find_collab', 'find_expertise', 'announce_project', 'rfc'])
  mode!: WallMode;

  @IsString()
  @MaxLength(32)
  schemaVersion!: string;

  @IsString()
  @MaxLength(8192)
  payloadEnc!: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @IsBoolean()
  guardPassed!: boolean;
}

class CreateWallReplyDto {
  @IsDefined()
  answer!: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  rationaleEnc?: string;

  @IsBoolean()
  guardPassed!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  agentSig?: string;
}

@Controller('social/wall')
@UseGuards(JwtAuthGuard)
export class WallController {
  constructor(private svc: WallService) {}

  @Get('key/:tag')
  async key(@Param('tag') tag: string) {
    const k = await this.svc.getActiveBroadcastKey(tag);
    return { tag: k.tag, generation: k.generation, wrappedKey: k.wrappedKey.toString('base64') };
  }

  @Post('post')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async post(@Req() req: Request & { user: any }, @Body() body: CreateWallPostDto) {
    return this.svc.post(req.user.sub, body);
  }

  @Get('tag/:tag')
  async listByTag(
    @Req() req: Request & { user: any },
    @Param('tag') tag: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 50;
    return { posts: await this.svc.listByTag(req.user.sub, tag, n) };
  }

  @Post(':id/reply')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async reply(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: CreateWallReplyDto,
  ) {
    return this.svc.reply(req.user.sub, id, body);
  }

  @Get(':id/replies')
  async replies(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.listReplies(req.user.sub, id);
  }
}
