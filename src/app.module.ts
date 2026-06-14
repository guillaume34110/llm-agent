// Local-first + friend-graph P2P (CLAUDE.md invariant, pivot 2026-05-22 Spec A).
// Demonetization (2026-05-25): no billing, no cosmetics catalog, no credits.
// Server = auth + presence + sharing ACL + attestation. Routing meta only,
// never payloads.
import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { HealthModule } from './health/health.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ModelsModule } from './models/models.module';
import { DownloadsModule } from './downloads/downloads.module';
import { PresenceModule } from './presence/presence.module';
import { SharingModule } from './sharing/sharing.module';
import { AttestationModule } from './attestation/attestation.module';
import { SocialModule } from './social/social.module';
import { ForgeModule } from './forge/forge.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/{*splat}'],
      serveStaticOptions: { fallthrough: true },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60000, limit: 120 },
      { name: 'auth',    ttl: 60000, limit: 20 },
      { name: 'stream',  ttl: 60000, limit: 240 },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ModelsModule,
    DownloadsModule,
    PresenceModule,
    SharingModule,
    AttestationModule,
    SocialModule,
    ForgeModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
