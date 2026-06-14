// Forge OAuth: GitHub today, GitLab/Gitea/Forgejo behind the same interface
// tomorrow. Tokens are encrypted at rest with a server-held KEK derived from
// FORGE_KEK_HEX. Agent tools (clone/list/PR) hit the forge via a typed client
// — never store user repo content on the server.

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type ForgeProvider = 'github' | 'gitlab' | 'gitea' | 'forgejo';
const ALLOWED: ReadonlySet<ForgeProvider> = new Set(['github', 'gitlab', 'gitea', 'forgejo']);

class UpsertForgeAccountDto {
  @IsString()
  @IsIn(['github', 'gitlab', 'gitea', 'forgejo'])
  provider!: ForgeProvider;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  externalId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  handle!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  accessToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  refreshToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  expiresAt?: string;
}

function getKek(): Buffer {
  const hex = process.env.FORGE_KEK_HEX;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('FORGE_KEK_HEX must be set to 64 hex chars');
  }
  return Buffer.from(hex, 'hex');
}

function encryptToken(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKek(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

function decryptToken(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getKek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export interface ForgeAccountDto {
  id: string;
  provider: ForgeProvider;
  externalId: string;
  handle: string;
  scope: string;
  expiresAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class ForgeService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string): Promise<ForgeAccountDto[]> {
    const rows = await this.prisma.forgeAccount.findMany({ where: { userId } });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider as ForgeProvider,
      externalId: r.externalId,
      handle: r.handle,
      scope: r.scope,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }

  async upsert(
    userId: string,
    body: {
      provider: ForgeProvider;
      externalId: string;
      handle: string;
      accessToken: string;
      refreshToken?: string;
      scope?: string;
      expiresAt?: string;
    },
  ) {
    if (!ALLOWED.has(body.provider)) throw new BadRequestException('unknown provider');
    if (!body.accessToken || body.accessToken.length > 4096) throw new BadRequestException('bad access token');
    const data = {
      userId,
      provider: body.provider,
      externalId: body.externalId,
      handle: body.handle,
      accessTokenEnc: encryptToken(body.accessToken),
      refreshTokenEnc: body.refreshToken ? encryptToken(body.refreshToken) : null,
      scope: body.scope || '',
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    };
    await this.prisma.forgeAccount.upsert({
      where: { userId_provider: { userId, provider: body.provider } },
      create: data,
      update: data,
    });
    return { ok: true };
  }

  async remove(userId: string, provider: string) {
    const res = await this.prisma.forgeAccount.deleteMany({ where: { userId, provider } });
    if (res.count === 0) throw new NotFoundException('account not linked');
    return { ok: true };
  }

  // Internal: agents fetch a short-lived plaintext token via JWT-scoped call.
  // We never expose this over a public endpoint; instead the agent runtime
  // calls `getDecryptedToken` directly through DI when running server-side
  // tools. Kept here for completeness — surface intentionally narrow.
  async getDecryptedToken(userId: string, provider: ForgeProvider): Promise<string> {
    const row = await this.prisma.forgeAccount.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!row) throw new ForbiddenException('not linked');
    if (row.expiresAt && row.expiresAt <= new Date()) throw new ForbiddenException('token expired');
    return decryptToken(row.accessTokenEnc);
  }
}

@Controller('forge/accounts')
@UseGuards(JwtAuthGuard)
class ForgeController {
  constructor(private svc: ForgeService) {}

  @Get()
  async list(@Req() req: Request & { user: any }) {
    return { accounts: await this.svc.list(req.user.sub) };
  }

  @Post()
  async upsert(@Req() req: Request & { user: any }, @Body() body: UpsertForgeAccountDto) {
    return this.svc.upsert(req.user.sub, body);
  }

  @Delete(':provider')
  async remove(@Req() req: Request & { user: any }, @Param('provider') provider: string) {
    return this.svc.remove(req.user.sub, provider);
  }
}

@Module({
  imports: [PrismaModule],
  providers: [ForgeService],
  controllers: [ForgeController],
  exports: [ForgeService],
})
export class ForgeModule {}
