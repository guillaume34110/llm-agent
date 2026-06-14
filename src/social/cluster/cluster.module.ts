import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClusterService } from './cluster.service';
import { ClusterController } from './cluster.controller';

@Module({
  imports: [PrismaModule],
  providers: [ClusterService],
  controllers: [ClusterController],
  exports: [ClusterService],
})
export class ClusterModule {}
