import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentCertService } from './agent-cert.service';

@Module({
  imports: [PrismaModule],
  providers: [AgentCertService],
  exports: [AgentCertService],
})
export class AgentCertModule {}
