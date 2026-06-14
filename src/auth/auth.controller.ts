import { Controller, Post, Body, Get, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Request, Response } from 'express';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

function cookieOptions(rememberMe = false) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: (process.env.COOKIE_SAMESITE as any) || 'lax',
    ...(rememberMe
      ? { maxAge: 30 * 24 * 60 * 60 * 1000 }  // 30 days
      : {}),                                     // session cookie
  };
}

class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  newPassword!: string;
}

// Auth rate-limit is strict by default (fail-closed). It is only relaxed when an
// explicit dev opt-in is set (DEV_DISABLE_RATELIMIT=1), so a missing/incorrect
// NODE_ENV can never silently disable brute-force protection in production.
const DEV_DISABLE_RATELIMIT = process.env.DEV_DISABLE_RATELIMIT === '1';
const authLimit = (limit: number, ttl = 60000) => ({ auth: { limit: DEV_DISABLE_RATELIMIT ? 1_000_000 : limit, ttl } });

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle(authLimit(5))
  @Post('register')
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(body.email, body.password);
    res.cookie('token', result.token, cookieOptions());
    return { user: result.user, token: result.token };
  }

  @Throttle(authLimit(5))
  @Post('login')
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(body.email, body.password);
    res.cookie('token', result.token, cookieOptions(body.rememberMe));
    return { user: result.user, token: result.token };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response) {
    const opts = cookieOptions();
    res.clearCookie('token', { httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, maxAge: 0 });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: Request & { user: any }) {
    return this.authService.me(req.user.sub);
  }

  @Throttle(authLimit(3))
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(body.email);
    return { ok: true }; // always success (no enumeration)
  }

  @Throttle(authLimit(5))
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() body: ResetPasswordDto) {
    await this.authService.resetPassword(body.token, body.password);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Req() req: Request & { user: any }, @Body() body: ChangePasswordDto) {
    return this.authService.changePassword(req.user.sub, body.currentPassword, body.newPassword);
  }
}
