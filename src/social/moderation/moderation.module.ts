import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { AgentCertModule } from '../agent-cert.module';

@Module({
  imports: [PrismaModule, AgentCertModule],
  providers: [ModerationService],
  controllers: [ModerationController],
  exports: [ModerationService],
})
export class ModerationModule {}
