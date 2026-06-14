import { Module } from '@nestjs/common';
import { AttestationService } from './attestation.service';
import { AttestationController } from './attestation.controller';
import { CanarySamplerService } from './canary-sampler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [PrismaModule, PresenceModule],
  providers: [AttestationService, CanarySamplerService],
  controllers: [AttestationController],
  exports: [AttestationService],
})
export class AttestationModule {}
