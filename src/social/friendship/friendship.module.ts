import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { randomBytes } from 'crypto';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_PREFIX = 'FRND';

// Crockford base32 alphabet (no 0/O, no I/L/1 confusion).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateToken(): string {
  const buf = randomBytes(10);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += ALPHABET[buf[i] % 32];
  return `${TOKEN_PREFIX}-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 10)}`;
}

function normalizeToken(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

class RedeemInviteDto {
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  token!: string;
}

@Injectable()
export class FriendshipService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.friendship.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async remove(userId: string, friendId: string) {
    const exists = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId, friendId } },
    });
    if (!exists) throw new NotFoundException('not a friend');
    await this.prisma.$transaction([
      this.prisma.friendship.deleteMany({ where: { userId, friendId } }),
      this.prisma.friendship.deleteMany({ where: { userId: friendId, friendId: userId } }),
    ]);
    return { ok: true };
  }

  // S9 — reputation score derived from past valid collaborations.
  // v2 is anti-gameable: two accounts that pingpong each other build a tight
  // bubble whose contribution decays to ~0. Each match-earned friendship is
  // weighted by (a) age factor — recent additions count less, prevents burst
  // farming, (b) friend's own graph richness — isolated accounts contribute
  // near-zero. Raw sum is log-compressed to 0-100.
  async reputation(userId: string) {
    const friends = await this.prisma.friendship.findMany({
      where: { userId, viaSessionId: { not: null } },
      select: { friendId: true, createdAt: true },
    });
    const earned = friends.length;
    if (earned === 0) return { earned: 0, score: 0 };

    const now = Date.now();
    let raw = 0;
    for (const f of friends) {
      const ageDays = Math.max(0, (now - f.createdAt.getTime()) / 86_400_000);
      const ageWeight = ageDays / (ageDays + 30); // 0 at t=0, 0.5 at 30d, ~1 long-term
      const fofCount = await this.prisma.friendship.count({
        where: { userId: f.friendId, friendId: { not: userId } },
      });
      const diversity = Math.log10(1 + fofCount);
      raw += ageWeight * diversity;
    }
    const score = Math.min(100, Math.round(25 * Math.log10(1 + raw * 4)));
    return { earned, score };
  }

  async createInvite(userId: string) {
    // 6 attempts is overkill (collision odds ≈ 2^-50) but cheap insurance.
    for (let i = 0; i < 6; i++) {
      const token = generateToken();
      try {
        const inv = await this.prisma.friendInvite.create({
          data: { token, fromUserId: userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
        });
        return { token: inv.token, expiresAt: inv.expiresAt };
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    }
    throw new ConflictException('could not allocate invite token');
  }

  async redeemInvite(userId: string, rawToken: string) {
    const token = normalizeToken(rawToken);
    if (!token.startsWith(TOKEN_PREFIX + '-')) throw new BadRequestException('invalid token');
    const inv = await this.prisma.friendInvite.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('invite not found');
    if (inv.usedAt) throw new ConflictException('invite already used');
    if (inv.expiresAt.getTime() < Date.now()) throw new BadRequestException('invite expired');
    if (inv.fromUserId === userId) throw new BadRequestException('cannot redeem own invite');

    const already = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId, friendId: inv.fromUserId } },
    });
    if (already) {
      await this.prisma.friendInvite.update({
        where: { id: inv.id },
        data: { usedAt: new Date(), usedByUserId: userId },
      });
      return { ok: true, friendId: inv.fromUserId, already: true };
    }

    await this.prisma.$transaction([
      this.prisma.friendInvite.updateMany({
        where: { id: inv.id, usedAt: null },
        data: { usedAt: new Date(), usedByUserId: userId },
      }),
      this.prisma.friendship.createMany({
        data: [
          { userId, friendId: inv.fromUserId },
          { userId: inv.fromUserId, friendId: userId },
        ],
        skipDuplicates: true,
      }),
    ]);
    return { ok: true, friendId: inv.fromUserId, already: false };
  }

  async listInvites(userId: string) {
    const rows = await this.prisma.friendInvite.findMany({
      where: { fromUserId: userId, expiresAt: { gt: new Date() }, usedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(r => ({ token: r.token, expiresAt: r.expiresAt, createdAt: r.createdAt }));
  }

  async revokeInvite(userId: string, token: string) {
    const norm = normalizeToken(token);
    const inv = await this.prisma.friendInvite.findUnique({ where: { token: norm } });
    if (!inv) throw new NotFoundException('invite not found');
    if (inv.fromUserId !== userId) throw new ForbiddenException('not owner');
    if (inv.usedAt) throw new ConflictException('already used');
    await this.prisma.friendInvite.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(0) },
    });
    return { ok: true };
  }
}

@Controller('social/friends')
@UseGuards(JwtAuthGuard)
class FriendshipController {
  constructor(private svc: FriendshipService) {}

  @Get()
  async list(@Req() req: Request & { user: any }) {
    return { friends: await this.svc.list(req.user.sub) };
  }

  @Get('reputation')
  async reputation(@Req() req: Request & { user: any }) {
    return this.svc.reputation(req.user.sub);
  }

  @Post(':id/remove')
  async remove(@Req() req: Request & { user: any }, @Param('id') id: string) {
    if (id === req.user.sub) throw new ForbiddenException('cannot remove self');
    return this.svc.remove(req.user.sub, id);
  }

  @Post('invite')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async createInvite(@Req() req: Request & { user: any }) {
    return this.svc.createInvite(req.user.sub);
  }

  @Get('invite')
  async listInvites(@Req() req: Request & { user: any }) {
    return { invites: await this.svc.listInvites(req.user.sub) };
  }

  @Post('redeem')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async redeem(@Req() req: Request & { user: any }, @Body() body: RedeemInviteDto) {
    return this.svc.redeemInvite(req.user.sub, body.token);
  }

  @Post('invite/:token/revoke')
  async revokeInvite(@Req() req: Request & { user: any }, @Param('token') token: string) {
    return this.svc.revokeInvite(req.user.sub, token);
  }
}

@Module({
  imports: [PrismaModule],
  providers: [FriendshipService],
  controllers: [FriendshipController],
  exports: [FriendshipService],
})
export class FriendshipModule {}
