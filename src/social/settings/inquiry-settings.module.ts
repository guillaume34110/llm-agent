import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { InquirySettingsService } from './inquiry-settings.service';
import { InquirySettingsController } from './inquiry-settings.controller';

@Module({
  imports: [PrismaModule],
  providers: [InquirySettingsService],
  controllers: [InquirySettingsController],
  exports: [InquirySettingsService],
})
export class InquirySettingsModule {}
