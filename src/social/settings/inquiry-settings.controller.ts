import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InquirySettingsService, InquirySettingsInput } from './inquiry-settings.service';

class InquirySettingsDto implements InquirySettingsInput {
  @IsOptional()
  @IsBoolean()
  acceptInquiries?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  acceptedModes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  acceptedTags?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  maxPerDay?: number;
}

@Controller('social/inquiry-settings')
@UseGuards(JwtAuthGuard)
export class InquirySettingsController {
  constructor(private svc: InquirySettingsService) {}

  @Get()
  async get(@Req() req: Request & { user: any }) {
    return this.svc.get(req.user.sub);
  }

  @Put()
  async update(@Req() req: Request & { user: any }, @Body() body: InquirySettingsDto) {
    return this.svc.update(req.user.sub, body || {});
  }
}
