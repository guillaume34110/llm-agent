import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DownloadsService } from './downloads.service';
import { DownloadsController } from './downloads.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminKeyGuard } from '../common/admin-key.guard';

@Module({
  imports: [PrismaModule, MulterModule.register({ limits: { fileSize: 500 * 1024 * 1024 } })],
  providers: [DownloadsService, AdminKeyGuard],
  controllers: [DownloadsController],
})
export class DownloadsModule {}
