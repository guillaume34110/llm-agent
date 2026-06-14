import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        } : undefined,
      });
    }
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    if (!this.transporter) {
      this.logger.warn(`[DEV] Password reset for ${email}: ${resetUrl}`);
      return;
    }

    const from = process.env.SMTP_FROM || 'noreply@progsoft.ai';
    await this.transporter.sendMail({
      from,
      to: email,
      subject: 'Réinitialisation de votre mot de passe — Monkey',
      html: `
        <p>Bonjour,</p>
        <p>Cliquez sur le lien ci-dessous pour réinitialiser votre mot de passe (valide 1 heure) :</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
      `,
      text: `Lien de réinitialisation (1h) : ${resetUrl}`,
    });
  }
}
