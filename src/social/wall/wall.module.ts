import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WallService } from './wall.service';
import { WallController } from './wall.controller';
import { ModerationModule } from '../moderation/moderation.module';
import { InquirySettingsModule } from '../settings/inquiry-settings.module';

@Module({
  imports: [PrismaModule, ModerationModule, InquirySettingsModule],
  providers: [WallService],
  controllers: [WallController],
  exports: [WallService],
})
export class WallModule {}
