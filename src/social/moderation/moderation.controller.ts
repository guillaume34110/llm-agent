import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ModerationService } from './moderation.service';
import { AgentCertService } from '../agent-cert.service';
import { PrismaService } from '../../prisma/prisma.service';

class RevokeCertDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  fingerprint!: string;

  @IsString()
  @MaxLength(200)
  reason!: string;
}

class BlockUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

class SignalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  targetUserId!: string;

  @IsString()
  @IsIn(['inquiry', 'inquiry_response', 'wall_post', 'wall_reply', 'project_member'])
  targetKind!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  targetId!: string;

  @IsString()
  @IsIn(['spam', 'harass', 'leak', 'guard_bypass', 'other'])
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@Controller('social/moderation')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(
    private mod: ModerationService,
    private agentCert: AgentCertService,
    private prisma: PrismaService,
  ) {}

  @Post('revoke-cert')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async revokeCert(
    @Req() req: Request & { user: any },
    @Body() body: RevokeCertDto,
  ) {
    const u = await this.prisma.user.findUnique({ where: { id: req.user.sub }, select: { role: true } });
    if (u?.role !== 'admin') throw new ForbiddenException('admin only');
    if (!/^[0-9a-f]{64}$/.test(body.fingerprint)) throw new ForbiddenException('bad fingerprint');
    return this.agentCert.revoke(body.fingerprint, body.reason ?? '');
  }

  @Post('block/:userId')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async block(@Req() req: Request & { user: any }, @Param('userId') target: string, @Body() body: BlockUserDto) {
    return this.mod.block(req.user.sub, target, body.reason);
  }

  @Delete('block/:userId')
  async unblock(@Req() req: Request & { user: any }, @Param('userId') target: string) {
    return this.mod.unblock(req.user.sub, target);
  }

  @Get('blocks')
  async listBlocks(@Req() req: Request & { user: any }) {
    return { blocked: await this.mod.listBlocked(req.user.sub) };
  }

  @Post('signal')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async signal(@Req() req: Request & { user: any }, @Body() body: SignalDto) {
    return this.mod.signal({ reporterId: req.user.sub, ...body });
  }
}
