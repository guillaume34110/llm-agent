import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccountController } from './account.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtStrategy } from './jwt.strategy';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('JWT_SECRET env var is required');
        return { secret, signOptions: { expiresIn: '7d' } };
      },
    }),
    PrismaModule,
    MailModule,
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController, AccountController],
  exports: [AuthService],
})
export class AuthModule {}
