import { BadRequestException, Body, Controller, Delete, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PresenceService } from './presence.service';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

interface AuthedRequest { user: { sub: string; role?: string } }
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

class AnnouncePresenceDto {
  @IsString()
  @Matches(DEVICE_ID_RE)
  deviceId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  modelId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(512)
  networkAddr!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(512)
  noisePubkey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  modelDigest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  weightDigest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  task?: string;
}

// Stable per-install identifier — UUID-like, length-bounded.
function validateDeviceId(raw: string | undefined): string {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > 128) {
    throw new BadRequestException('deviceId required (8-128 chars)');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new BadRequestException('deviceId must be alphanum/_/-');
  return raw;
}

function parseSinceMinutes(raw?: string): number {
  if (!raw) return 5;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(n, 60);
}

@Controller('presence')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private presence: PresenceService) {}

  @Post('announce')
  async announce(
    @Req() req: AuthedRequest,
    @Body() body: AnnouncePresenceDto,
  ) {
    const deviceId = validateDeviceId(body.deviceId);
    return this.presence.announce({
      userId: req.user.sub,
      deviceId,
      modelId: body.modelId,
      networkAddr: body.networkAddr,
      noisePubkey: body.noisePubkey,
      modelDigest: body.modelDigest ?? null,
      weightDigest: body.weightDigest ?? null,
      task: body.task ?? null,
    });
  }

  @Delete('withdraw')
  async withdraw(
    @Req() req: AuthedRequest,
    @Query('modelId') modelId?: string,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.presence.withdraw(req.user.sub, { modelId, deviceId });
  }

  @Get('friends')
  async friends(
    @Req() req: AuthedRequest,
    @Query('modelId') modelId?: string,
    @Query('task') task?: string,
    @Query('sinceMinutes') sinceMinutesRaw?: string,
  ) {
    const sinceMinutes = parseSinceMinutes(sinceMinutesRaw);
    return this.presence.listFriendProviders(req.user.sub, { modelId, task, sinceMinutes });
  }

  // Own-devices directory. Caller passes X-Device-Id header to exclude itself
  // (no point routing to the same machine). No friendship check — same user.
  @Get('mine')
  async mine(
    @Req() req: AuthedRequest,
    @Headers('x-device-id') callerDeviceId: string | undefined,
    @Query('modelId') modelId?: string,
    @Query('task') task?: string,
    @Query('sinceMinutes') sinceMinutesRaw?: string,
  ) {
    const sinceMinutes = parseSinceMinutes(sinceMinutesRaw);
    const excludeDeviceId = callerDeviceId && DEVICE_ID_RE.test(callerDeviceId)
      ? callerDeviceId
      : undefined;
    return this.presence.listMyDevices(req.user.sub, { excludeDeviceId, modelId, task, sinceMinutes });
  }
}
