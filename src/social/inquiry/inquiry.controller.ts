import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { IsArray, ArrayMaxSize, ArrayMinSize, IsBoolean, IsDefined, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, Max } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InquiryService } from './inquiry.service';
import type { InquiryMode } from '../schemas';

class BroadcastInquiryDto {
  @IsString()
  @IsIn(['find_expertise', 'find_mate', 'find_worker', 'find_opinion', 'find_review', 'find_collab'])
  mode!: InquiryMode;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25)
  fanout?: number;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  questionDigest!: string;
}

class RespondInquiryDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  agentPubkey?: string;
}

@Controller('social/inquiry')
@UseGuards(JwtAuthGuard)
export class InquiryController {
  constructor(private svc: InquiryService) {}

  @Post('broadcast')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async broadcast(@Req() req: Request & { user: any }, @Body() body: BroadcastInquiryDto) {
    return this.svc.broadcast(req.user.sub, body);
  }

  @Get('inbox')
  async inbox(@Req() req: Request & { user: any }) {
    return { inquiries: await this.svc.listOpenForResponder(req.user.sub) };
  }

  @Post(':id/respond')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async respond(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: RespondInquiryDto,
  ) {
    return this.svc.respond(req.user.sub, id, body);
  }

  @Get(':id')
  async get(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.getForInitiator(req.user.sub, id);
  }

  @Post(':id/close')
  async close(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.close(req.user.sub, id);
  }
}
