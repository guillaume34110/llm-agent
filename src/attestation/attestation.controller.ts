import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AttestationService } from './attestation.service';

class AttestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  modelId!: string;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  runtimeHash!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  runtimeSig!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,128}$/)
  deviceId?: string;
}

class SampleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  canary!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(65536)
  response!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  modelId?: string;
}

@Controller('attestation')
@UseGuards(JwtAuthGuard)
export class AttestationController {
  constructor(private attestation: AttestationService) {}

  @Post('attest')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async attest(
    @Req() req: Request & { user: any },
    @Body() body: AttestDto,
  ) {
    const userId = req.user.sub;
    let deviceId: string | undefined;
    if (body.deviceId !== undefined) {
      if (typeof body.deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.deviceId)) {
        throw new BadRequestException('deviceId must be 8-128 alphanum/_/-');
      }
      deviceId = body.deviceId;
    }
    return this.attestation.attest(userId, { ...body, deviceId });
  }

  @Post('sample')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async sample(@Req() req: Request & { user: any }, @Body() body: SampleDto) {
    return this.attestation.recordSample({
      providerId: req.user.sub,
      modelId: body.modelId,
      canary: body.canary,
      response: body.response,
    });
  }
}
