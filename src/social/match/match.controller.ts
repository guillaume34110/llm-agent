import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { MatchService } from './match.service';

class StartMatchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  inquiryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  responderId!: string;
}

class MatchTurnDto {
  @IsString()
  @MinLength(4)
  @MaxLength(32768)
  ciphertext!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  agentPubkey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  agentSig?: string;
}

class MatchCloseDto {
  @IsString()
  @IsIn(['completed', 'rejected', 'timeout', 'abort'])
  reason!: string;
}

class SubmitMatchReportDto {
  @IsString()
  @MinLength(4)
  @MaxLength(131072)
  ciphertext!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(1024)
  agentSigA!: string;
}

class AckMatchReportDto {
  @IsString()
  @MinLength(4)
  @MaxLength(1024)
  agentSigB!: string;
}

class MatchConsentDto {
  @IsString()
  @IsIn(['accept', 'reject'])
  decision!: 'accept' | 'reject';
}

@Controller('social/match')
@UseGuards(JwtAuthGuard)
export class MatchController {
  constructor(private svc: MatchService) {}

  @Post('start')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async start(
    @Req() req: Request & { user: any },
    @Body() body: StartMatchDto,
  ) {
    return this.svc.start(req.user.sub, body.inquiryId, body.responderId);
  }

  @Get('mine')
  async mine(@Req() req: Request & { user: any }) {
    return { sessions: await this.svc.listMine(req.user.sub) };
  }

  @Get(':id')
  async get(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.get(req.user.sub, id);
  }

  @Post(':id/turn')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async turn(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: MatchTurnDto,
  ) {
    return this.svc.appendTurn(req.user.sub, id, body);
  }

  @Post(':id/close')
  async close(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: MatchCloseDto,
  ) {
    return this.svc.close(req.user.sub, id, body.reason);
  }

  @Get(':id/anon')
  async anon(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.anonView(req.user.sub, id);
  }

  @Post(':id/report')
  async submitReport(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: SubmitMatchReportDto,
  ) {
    return this.svc.submitReport(req.user.sub, id, body);
  }

  @Post(':id/report/ack')
  async ackReport(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: AckMatchReportDto,
  ) {
    return this.svc.ackReport(req.user.sub, id, body.agentSigB);
  }

  @Get(':id/report')
  async getReport(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.getReport(req.user.sub, id);
  }

  @Post(':id/consent')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async consent(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: MatchConsentDto,
  ) {
    return this.svc.consent(req.user.sub, id, body.decision);
  }
}
