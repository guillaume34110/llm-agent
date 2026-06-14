import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [PrismaModule, ModerationModule],
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
