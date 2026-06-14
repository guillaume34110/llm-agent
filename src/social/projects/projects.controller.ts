import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProjectsService } from './projects.service';

class SetHumanChatDto {
  @IsBoolean()
  accept!: boolean;
}

class UploadProjectDocDto {
  @IsString()
  @MaxLength(7_000_000)
  ciphertext!: string;

  @IsString()
  @MaxLength(128)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  keyGen?: number;
}

@Controller('social/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private svc: ProjectsService) {}

  @Get()
  async listMine(@Req() req: Request & { user: any }) {
    return { rooms: await this.svc.listMine(req.user.sub) };
  }

  @Get(':id')
  async get(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.get(req.user.sub, id);
  }

  @Post(':id/leave')
  async leave(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.leave(req.user.sub, id);
  }

  @Put(':id/human-chat')
  async setHumanChat(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: SetHumanChatDto,
  ) {
    return this.svc.setHumanChat(req.user.sub, id, body.accept);
  }

  @Get(':id/human-chat/peers')
  async humanChatPeers(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return { peers: await this.svc.humanChatPeers(req.user.sub, id) };
  }

  @Post(':id/docs')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async uploadDoc(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() body: UploadProjectDocDto,
  ) {
    return this.svc.uploadDoc(req.user.sub, id, body);
  }

  @Get(':id/docs')
  async listDocs(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return { docs: await this.svc.listDocs(req.user.sub, id) };
  }

  @Get(':id/docs/:docId')
  async getDoc(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.svc.getDoc(req.user.sub, id, docId);
  }

  @Delete(':id/docs/:docId')
  async deleteDoc(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.svc.deleteDoc(req.user.sub, id, docId);
  }
}
