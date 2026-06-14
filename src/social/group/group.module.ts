import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

const MAX_TITLE = 80;
const MAX_MSG_BYTES = 32 * 1024;
const MAX_WRAP_BYTES = 1024;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024; // 8 MiB
const BUNDLE_TTL_MS = 60 * 60 * 1000;

class GroupMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  userId!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(2048)
  wrappedKey!: string;
}

class CreateGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TITLE)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GroupMemberDto)
  members!: GroupMemberDto[];
}

class PostGroupMessageDto {
  @IsString()
  @MinLength(4)
  @MaxLength(65536)
  ciphertext!: string;
}

class PublishKbDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  modelId!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(12_000_000)
  ciphertext!: string;
}

@Injectable()
export class GroupService {
  constructor(private prisma: PrismaService) {}

  async create(ownerId: string, body: { title: string; members: Array<{ userId: string; wrappedKey: string }> }) {
    const title = (body.title || '').slice(0, MAX_TITLE).trim();
    if (!title) throw new BadRequestException('title required');
    if (!Array.isArray(body.members) || body.members.length === 0) {
      throw new BadRequestException('at least one member required');
    }
    if (body.members.length > 50) throw new BadRequestException('member cap exceeded');

    const thread = await this.prisma.groupThread.create({
      data: {
        ownerId,
        title,
        members: {
          create: body.members.map((m) => {
            const wrap = Buffer.from(m.wrappedKey, 'base64');
            if (wrap.length === 0 || wrap.length > MAX_WRAP_BYTES) {
              throw new BadRequestException(`bad wrappedKey for ${m.userId}`);
            }
            return { userId: m.userId, wrappedKey: wrap };
          }),
        },
      },
      include: { members: true },
    });
    return thread;
  }

  async listMine(userId: string) {
    return this.prisma.groupThread.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { members: { select: { userId: true } } },
    });
  }

  async ensureMember(userId: string, threadId: string) {
    const t = await this.prisma.groupThread.findUnique({
      where: { id: threadId },
      include: { members: { where: { userId } } },
    });
    if (!t) throw new NotFoundException('thread not found');
    if (t.ownerId !== userId && t.members.length === 0) throw new ForbiddenException('not a member');
    return t;
  }

  async myWrappedKey(userId: string, threadId: string) {
    const m = await this.prisma.groupMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!m) throw new ForbiddenException('not a member');
    return { wrappedKey: m.wrappedKey.toString('base64') };
  }

  async post(userId: string, threadId: string, ciphertext: string) {
    await this.ensureMember(userId, threadId);
    const ct = Buffer.from(ciphertext, 'base64');
    if (ct.length === 0 || ct.length > MAX_MSG_BYTES) throw new BadRequestException('bad ciphertext');
    return this.prisma.groupMessage.create({
      data: { threadId, senderId: userId, ciphertext: ct },
    });
  }

  async messages(userId: string, threadId: string, since?: string) {
    await this.ensureMember(userId, threadId);
    const where: any = { threadId };
    if (since) where.createdAt = { gt: new Date(since) };
    const rows = await this.prisma.groupMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      senderId: r.senderId,
      ciphertext: r.ciphertext.toString('base64'),
      createdAt: r.createdAt,
    }));
  }

  async publishKb(userId: string, threadId: string, body: { modelId: string; ciphertext: string }) {
    await this.ensureMember(userId, threadId);
    if (!body.modelId || body.modelId.length > 120) throw new BadRequestException('bad modelId');
    const ct = Buffer.from(body.ciphertext, 'base64');
    if (ct.length === 0 || ct.length > MAX_BUNDLE_BYTES) throw new BadRequestException('bad ciphertext');
    const expiresAt = new Date(Date.now() + BUNDLE_TTL_MS);
    return this.prisma.groupKbBundle.create({
      data: { threadId, ownerId: userId, modelId: body.modelId, ciphertext: ct, expiresAt },
    });
  }

  async listKb(userId: string, threadId: string) {
    await this.ensureMember(userId, threadId);
    const now = new Date();
    const rows = await this.prisma.groupKbBundle.findMany({
      where: { threadId, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      modelId: r.modelId,
      ciphertext: r.ciphertext.toString('base64'),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }
}

@Controller('social/group')
@UseGuards(JwtAuthGuard)
class GroupController {
  constructor(private svc: GroupService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(@Req() req: Request & { user: any }, @Body() body: CreateGroupDto) {
    return this.svc.create(req.user.sub, body);
  }

  @Get('mine')
  async mine(@Req() req: Request & { user: any }) {
    return { threads: await this.svc.listMine(req.user.sub) };
  }

  @Get(':id/key')
  async key(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.svc.myWrappedKey(req.user.sub, id);
  }

  @Post(':id/post')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async post(@Req() req: Request & { user: any }, @Param('id') id: string, @Body() body: PostGroupMessageDto) {
    return this.svc.post(req.user.sub, id, body.ciphertext);
  }

  @Get(':id/messages')
  async messages(@Req() req: Request & { user: any }, @Param('id') id: string, @Query('since') since?: string) {
    return { messages: await this.svc.messages(req.user.sub, id, since) };
  }

  @Post(':id/kb')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async kb(@Req() req: Request & { user: any }, @Param('id') id: string, @Body() body: PublishKbDto) {
    return this.svc.publishKb(req.user.sub, id, body);
  }

  @Get(':id/kb')
  async listKb(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return { bundles: await this.svc.listKb(req.user.sub, id) };
  }
}

@Module({
  imports: [PrismaModule],
  providers: [GroupService],
  controllers: [GroupController],
  exports: [GroupService],
})
export class GroupModule {}
