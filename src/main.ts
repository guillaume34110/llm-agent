import { bootstrapTracing } from './common/tracing';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as bodyParser from 'body-parser';
import cookieParser = require('cookie-parser');
import { doubleCsrf } from 'csrf-csrf';
import { randomBytes } from 'crypto';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  await bootstrapTracing();
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET env var is required in production');
    if (!process.env.FRONTEND_ORIGIN) throw new Error('FRONTEND_ORIGIN env var is required in production');
    if (!process.env.CSRF_SECRET) throw new Error('CSRF_SECRET env var is required in production');
  }
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  const allowedOrigins = new Set<string>([
    frontendOrigin,
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'http://localhost:1420',
    'http://localhost:5173',
  ]);
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // No Origin header (curl, native fetch from same-origin) → allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`), false);
    },
    credentials: true,
  });
  app.use(cookieParser());
  app.use(bodyParser.json({ limit: '10mb' }));

  // CSRF protection using csrf-csrf (double-submit cookie pattern)
  const csrfSecret =
    process.env.CSRF_SECRET || `${process.env.JWT_SECRET || ''}${randomBytes(32).toString('hex')}`;
  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => csrfSecret,
    getSessionIdentifier: (req: any) => req.cookies?.token || req.ip || '',
    cookieName: 'XSRF-TOKEN',
    cookieOptions: {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
    getCsrfTokenFromRequest: (req: any) => req.headers['x-xsrf-token'] as string || req.headers['x-csrf-token'] as string,
  });

  // CSRF protection for cookie-authenticated mutating API requests.
  // Login/register/reset remain exempt because there is no trusted auth cookie yet.
  const CSRF_EXEMPT = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/csrf',
  ];
  app.use((req: any, res: any, next: any) => {
    const isStateMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const isApiRoute = req.originalUrl.startsWith('/api/');
    const hasSessionCookie = typeof req.cookies?.token === 'string' && req.cookies.token.length > 0;
    const isExempt = CSRF_EXEMPT.some(p => req.originalUrl.startsWith(p));
    if (isStateMutating && isApiRoute && hasSessionCookie && !isExempt) {
      return doubleCsrfProtection(req, res, next);
    }
    return next();
  });

  // Expose CSRF token cookie on GET /api/auth/csrf
  app.use((req: any, res: any, next: any) => {
    if (req.method === 'GET' && req.originalUrl.startsWith('/api/auth/csrf')) {
      try {
        const token = generateCsrfToken(req, res);
        res.cookie('XSRF-TOKEN', token, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
        return res.json({ ok: true, token });
      } catch (err) {
        logger.warn(`CSRF token generation failed: ${(err as Error).message}`);
        return res.status(500).json({ ok: false });
      }
    }
    next();
  });

  // Seed default admin if not exists
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@admin.com';
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme123';
  const prisma = new PrismaClient();
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await prisma.user.create({ data: { email: adminEmail, password: hash, role: 'admin', mustChangePassword: true } });
    logger.log(`Admin created: ${adminEmail} — change password on first login`);
  }
  await prisma.$disconnect();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Server listening on port ${port}`);

  // Graceful shutdown — drain connections before exit
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down…`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  if (process.env.NODE_ENV !== 'production') {
    // Keep alive in dev (e.g. background test runner)
    await new Promise(() => {});
  }
}
bootstrap();
