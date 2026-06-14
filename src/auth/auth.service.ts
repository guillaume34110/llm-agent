import { Injectable, Logger, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(private prisma: PrismaService, private jwt: JwtService, private mail: MailService) {}

  async register(email: string, password: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('User already exists');
    const hash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({ data: { email, password: hash } });
    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { user: { id: user.id, email: user.email, role: user.role }, token };
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return null;
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { user: { id: user.id, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword }, token };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new UnauthorizedException('Current password incorrect');
    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hash, mustChangePassword: false } });
    return { ok: true };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always return success to avoid email enumeration
    if (!user) return;

    // Delete previous tokens for this user
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, token: hashed, expiresAt },
    });

    await this.mail.sendPasswordReset(email, rawToken);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters');

    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.passwordResetToken.findUnique({ where: { token: hashed } });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Token invalide ou expiré.');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { password: hash, mustChangePassword: false },
    });
    await this.prisma.passwordResetToken.delete({ where: { token: hashed } });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, mustChangePassword: true } });
    return user;
  }

  // GDPR Art. 15 — return everything the server holds about this user.
  // ForgeAccount tokens are server-encrypted KEK secrets; redacted (not user-portable).
  // E2E ciphertext blobs (SharedConversation, MatchTurn, MatchReport, GroupMessage,
  // ProjectDoc, WallPost.payloadEnc) are included raw — only the holder of the
  // client-side key can decrypt; the server cannot.
  async exportData(userId: string) {
    const p = this.prisma;
    const [
      user,
      providerRegistrations,
      providerAttestations,
      aclAsProvider,
      aclAsFriend,
      publicProfile,
      sharedConversations,
      blocksAsBlocker,
      blocksAsBlocked,
      signalsReported,
      signalsReviewed,
      inquirySettings,
      inquiriesInitiated,
      inquiryResponses,
      matchSessionsInitiator,
      matchSessionsResponder,
      matchConsents,
      matchAnonIds,
      friendships,
      groupThreadsOwned,
      groupMemberships,
      groupMessagesSent,
      groupKbBundles,
      forgeAccounts,
      wallPosts,
      wallReplies,
      tagPseudonyms,
      clusterMembers,
      projectMemberships,
      projectChannelStates,
      projectDocsUploaded,
    ] = await Promise.all([
      p.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
      }),
      p.providerRegistration.findMany({ where: { userId } }),
      p.providerAttestation.findMany({ where: { userId } }),
      p.providerAcl.findMany({ where: { providerId: userId } }),
      p.providerAcl.findMany({ where: { friendId: userId } }),
      p.publicProfile.findUnique({ where: { userId } }),
      p.sharedConversation.findMany({ where: { ownerId: userId } }),
      p.userBlock.findMany({ where: { blockerId: userId } }),
      p.userBlock.findMany({ where: { blockedId: userId } }),
      p.userSignal.findMany({ where: { reporterId: userId } }),
      p.userSignal.findMany({ where: { reviewerId: userId } }),
      p.userInquirySettings.findUnique({ where: { userId } }),
      p.inquiryRequest.findMany({ where: { initiatorId: userId } }),
      p.inquiryResponse.findMany({ where: { responderId: userId } }),
      p.matchSession.findMany({ where: { initiatorId: userId } }),
      p.matchSession.findMany({ where: { responderId: userId } }),
      p.matchConsent.findMany({ where: { userId } }),
      p.matchAnonId.findMany({ where: { userId } }),
      p.friendship.findMany({ where: { userId } }),
      p.groupThread.findMany({ where: { ownerId: userId } }),
      p.groupMember.findMany({ where: { userId } }),
      p.groupMessage.findMany({ where: { senderId: userId } }),
      p.groupKbBundle.findMany({ where: { ownerId: userId } }),
      p.forgeAccount.findMany({ where: { userId } }),
      p.wallPost.findMany({ where: { authorId: userId } }),
      p.wallReply.findMany({ where: { responderId: userId } }),
      p.tagPseudonym.findMany({ where: { userId } }),
      p.clusterMember.findMany({ where: { userId } }),
      p.projectMember.findMany({ where: { userId } }),
      p.projectChannelState.findMany({ where: { userId } }),
      p.projectDoc.findMany({ where: { uploaderId: userId } }),
    ]);

    const forgeAccountsRedacted = forgeAccounts.map((f) => ({
      ...f,
      accessTokenEnc: '[REDACTED — server-encrypted KEK secret, not user-portable]',
      refreshTokenEnc: f.refreshTokenEnc ? '[REDACTED]' : null,
    }));

    return {
      generatedAt: new Date().toISOString(),
      note:
        'GDPR Art. 15 export. Server holds no plaintext chat content, memory, or knowledge base — those live locally in the desktop app. Encrypted (E2E) blobs are included raw; only your client-side keys can decrypt them.',
      user,
      provider: {
        registrations: providerRegistrations,
        attestations: providerAttestations,
        aclGrants: aclAsProvider,
      },
      consumer: { aclReceived: aclAsFriend },
      social: {
        publicProfile,
        sharedConversations,
        blocksAsBlocker,
        blocksAsBlocked,
        signalsReported,
        signalsReviewed,
        inquirySettings,
        inquiriesInitiated,
        inquiryResponses,
        matchSessionsInitiator,
        matchSessionsResponder,
        matchConsents,
        matchAnonIds,
        friendships,
        groupThreadsOwned,
        groupMemberships,
        groupMessagesSent,
        groupKbBundles,
        wallPosts,
        wallReplies,
        tagPseudonyms,
        clusterMembers,
        projectMemberships,
        projectChannelStates,
        projectDocsUploaded,
      },
      forgeAccounts: forgeAccountsRedacted,
    };
  }

  // GDPR Art. 17 — erase PII across every user-referencing table.
  // Demonetization (2026-05-25): no credits, no invoices, no fiscal hold.
  // ForgeAccount = highest priority: OAuth tokens must not survive erasure.
  async deleteAccount(userId: string) {
    const anonEmail = `deleted-${crypto.randomBytes(8).toString('hex')}@anonymized.invalid`;
    const anonPwd = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const p = this.prisma;

    await p.$transaction([
      // OAuth — purge first (active credential leak risk).
      p.forgeAccount.deleteMany({ where: { userId } }),

      // Operational
      p.passwordResetToken.deleteMany({ where: { userId } }),

      // Provider-side
      p.providerRegistration.deleteMany({ where: { userId } }),
      p.providerAttestation.deleteMany({ where: { userId } }),
      p.providerAcl.deleteMany({ where: { providerId: userId } }),
      p.providerAcl.deleteMany({ where: { friendId: userId } }),

      // Social — profile + shared blobs
      p.publicProfile.deleteMany({ where: { userId } }),
      p.sharedConversation.deleteMany({ where: { ownerId: userId } }),

      // Social — moderation
      p.userBlock.deleteMany({ where: { blockerId: userId } }),
      p.userBlock.deleteMany({ where: { blockedId: userId } }),
      p.userSignal.deleteMany({ where: { reporterId: userId } }),
      p.userSignal.deleteMany({ where: { reviewerId: userId } }),

      // Social — inquiry / match
      p.userInquirySettings.deleteMany({ where: { userId } }),
      p.inquiryResponse.deleteMany({ where: { responderId: userId } }),
      p.inquiryRequest.deleteMany({ where: { initiatorId: userId } }), // cascades responses
      p.matchConsent.deleteMany({ where: { userId } }),
      p.matchAnonId.deleteMany({ where: { userId } }),
      p.matchSession.deleteMany({ where: { initiatorId: userId } }), // cascades turns
      p.matchSession.deleteMany({ where: { responderId: userId } }),
      p.friendship.deleteMany({ where: { userId } }),
      p.friendship.deleteMany({ where: { friendId: userId } }),

      // Social — groups
      p.groupMessage.deleteMany({ where: { senderId: userId } }),
      p.groupMember.deleteMany({ where: { userId } }),
      p.groupKbBundle.deleteMany({ where: { ownerId: userId } }),
      p.groupThread.deleteMany({ where: { ownerId: userId } }), // cascades members + messages

      // Social — wall / cluster / project
      p.wallReply.deleteMany({ where: { responderId: userId } }),
      p.wallPost.deleteMany({ where: { authorId: userId } }), // cascades replies
      p.tagPseudonym.deleteMany({ where: { userId } }),
      p.clusterMember.deleteMany({ where: { userId } }),
      p.projectChannelState.deleteMany({ where: { userId } }),
      p.projectMember.deleteMany({ where: { userId } }),
      p.projectDoc.deleteMany({ where: { uploaderId: userId } }),

      // Finally: anonymise User row.
      p.user.update({
        where: { id: userId },
        data: { email: anonEmail, password: anonPwd, role: 'deleted', mustChangePassword: false },
      }),
    ]);
    return { ok: true };
  }

  // ─── Retention crons (GDPR data minimization) ─────────────────────────────
  // Daily at 03:00 — purge expired/aged rows. Idempotent: deleteMany on age
  // predicates. Failures are logged but never throw (cron must not crash app).

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredPasswordResetTokens() {
    try {
      const r = await this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (r.count > 0) this.logger.log(`Purged ${r.count} expired password reset tokens`);
    } catch (e) {
      this.logger.error('purgeExpiredPasswordResetTokens failed', e as any);
    }
  }

}
