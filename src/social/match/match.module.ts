import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ModerationModule } from '../moderation/moderation.module';
import { AgentCertModule } from '../agent-cert.module';
import { MatchService } from './match.service';
import { MatchController } from './match.controller';

@Module({
  imports: [PrismaModule, ModerationModule, AgentCertModule],
  providers: [MatchService],
  controllers: [MatchController],
  exports: [MatchService],
})
export class MatchModule {}
