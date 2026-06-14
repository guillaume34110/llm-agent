import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { InquiryService } from './inquiry.service';
import { InquiryController } from './inquiry.controller';
import { ModerationModule } from '../moderation/moderation.module';
import { InquirySettingsModule } from '../settings/inquiry-settings.module';
import { AgentCertModule } from '../agent-cert.module';

@Module({
  imports: [PrismaModule, ModerationModule, InquirySettingsModule, AgentCertModule],
  providers: [InquiryService],
  controllers: [InquiryController],
  exports: [InquiryService],
})
export class InquiryModule {}
