import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IsIn, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ClusterService } from './cluster.service';

class ClusterVoteDto {
  @IsString()
  @IsIn(['yes', 'no'])
  vote!: 'yes' | 'no';
}

@Controller('social/clusters')
@UseGuards(JwtAuthGuard)
export class ClusterController {
  constructor(private svc: ClusterService) {}

  @Get()
  async list(@Req() req: Request & { user: any }) {
    return { clusters: await this.svc.listForUser(req.user.sub) };
  }

  @Post(':id/vote')
  async vote(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: ClusterVoteDto,
  ) {
    return this.svc.vote(req.user.sub, id, body.vote);
  }
}
