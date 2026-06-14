import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Per-friend ACL — row exists ⇔ provider opted that friend in.
// Default OFF (Spec A invariant). Friendship must exist BOTH ways before ACL allowed.
@Injectable()
export class SharingService {
  constructor(private prisma: PrismaService) {}

  async list(providerId: string) {
    const rows = await this.prisma.providerAcl.findMany({
      where: { providerId },
      select: { friendId: true, createdAt: true },
    });
    return rows;
  }

  async grant(providerId: string, friendId: string) {
    if (providerId === friendId) throw new BadRequestException('cannot share with yourself');
    const [a, b] = await Promise.all([
      this.prisma.friendship.findUnique({ where: { userId_friendId: { userId: providerId, friendId } } }),
      this.prisma.friendship.findUnique({ where: { userId_friendId: { userId: friendId, friendId: providerId } } }),
    ]);
    if (!a || !b) throw new ForbiddenException('not mutual friends');
    return this.prisma.providerAcl.upsert({
      where: { providerId_friendId: { providerId, friendId } },
      update: {},
      create: { providerId, friendId },
    });
  }

  async revoke(providerId: string, friendId: string) {
    const r = await this.prisma.providerAcl.deleteMany({ where: { providerId, friendId } });
    return { revoked: r.count };
  }
}
