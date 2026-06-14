"""Full-stack App TS template — NestJS+Prisma+Postgres backend, React+Redux frontend.

Usage:
    from monkey.templates import app_fullstack_ts
    app_fullstack_ts.apply("/path/to/new-app", name="my-app", features=[...])

Architecture (STRICT, do not mix layers):

  Backend (apps/server):
    controller.ts  — routes only, ZERO business logic. Calls service.
    service.ts     — orchestrates use-cases. Calls logic + repository. Never Prisma direct.
    logic.ts       — pure functions (no IO, no Prisma, no Nest).
    repository.ts  — Prisma wrapper. Only IO. No business decision.
    dto.ts         — zod schemas + types.
    module.ts      — Nest wiring.
    *.logic.spec.ts / *.controller.spec.ts — logic + controller wiring tests.

  Frontend (apps/web):
    Slice.ts       — state shape + reducers (state machine).
    Thunks.ts      — async actions (calls Api).
    Api.ts         — fetch wrappers, returns DTOs.
    Selectors.ts   — derived state.
    *.tsx          — DUMB components, dispatch + select only, NO logic.
    Slice.test.ts  — pure reducer tests.

Features list (P1 baseline = none): later phases add 'auth', 'users', 'settings',
'uploads', 'dashboard', 'notifications'.
"""
from __future__ import annotations
from pathlib import Path

FILES: dict[str, str] = {}

# ─── ROOT ───────────────────────────────────────────────────────────────────

FILES["package.json"] = """{
  "name": "__APP_NAME__",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "npm run dev --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "db:up": "docker compose up -d db",
    "db:down": "docker compose down",
    "db:migrate": "npm run -w apps/server prisma:migrate",
    "db:studio": "npm run -w apps/server prisma:studio"
  }
}
"""

FILES["docker-compose.yml"] = """services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    ports: ["5544:5432"]
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 3s
      timeout: 3s
      retries: 10
volumes:
  dbdata:
"""

FILES["tsconfig.base.json"] = """{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022", "DOM"]
  }
}
"""

FILES[".dockerignore"] = """node_modules
**/node_modules
dist
**/dist
coverage
.git
.env
.env.local
"""

FILES[".prettierrc.json"] = """{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true
}
"""

FILES[".eslintrc.cjs"] = """module.exports = {
  root: true,
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { node: true, es2022: true, browser: true },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '*.cjs'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'eqeqeq': ['error', 'smart'],
  },
};
"""

FILES["apps/server/Dockerfile"] = """# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
RUN npm install --workspaces=false --no-audit --no-fund || npm install --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.base.json ./
COPY apps/server ./apps/server
WORKDIR /app/apps/server
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/server/package.json ./apps/server/
EXPOSE 3500
WORKDIR /app/apps/server
CMD ["node", "dist/main.js"]
"""

FILES["apps/web/Dockerfile"] = """# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund || true
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
"""

FILES["apps/web/nginx.conf"] = """server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://server:3500/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
"""

FILES[".gitignore"] = """node_modules
dist
.next
.turbo
coverage
*.log
.DS_Store
.env
.env.local
apps/server/prisma/migrations/dev.db*
"""

FILES[".env.example"] = """# copy to .env, then edit
DATABASE_URL=postgresql://app:app@localhost:5544/app?schema=public
JWT_SECRET=dev-secret-change-me
PORT=3500
WEB_PORT=5173
NODE_ENV=development
"""

FILES["AGENT.md"] = """# AGENT.md — full-stack app

Two workspaces: `apps/server` (NestJS+Prisma+Postgres) and `apps/web` (React+Redux+Vite).

## Layered architecture — NEVER mix

### Backend (apps/server)
Each feature is a directory `src/<feature>/` containing:
- `controller.ts` — routes only. NO logic. Validates input via dto, calls service, returns.
- `service.ts` — orchestrates use-cases. Calls `logic` + `repository`. NEVER touches Prisma.
- `logic.ts` — PURE functions. No IO, no Prisma, no Nest. Tested in isolation.
- `repository.ts` — Prisma wrapper. ONLY IO. Returns plain data.
- `dto.ts` — zod schemas + inferred types.
- `module.ts` — Nest module declaration.
- `*.logic.spec.ts` — pure unit tests.
- `*.controller.spec.ts` — controller/service wiring tests (pas un full HTTP e2e Nest).

Forbidden:
- Calling `prismaService` from a controller.
- Putting `if (user.role === ...)` in a repository.
- Doing async / db calls in `logic.ts`.

### Frontend (apps/web)
Each feature is `src/features/<feature>/` with:
- `Slice.ts` — state + reducers. The state machine.
- `Thunks.ts` — async, calls `Api`, dispatches Slice actions.
- `Api.ts` — fetch wrappers. Returns DTOs.
- `Selectors.ts` — `(state) => derived`.
- `Slice.test.ts` — pure reducer unit tests.
- Components consume via `useAppSelector` + `useAppDispatch` ONLY. NO `useEffect` doing
  fetch directly. NO conditional state computed inside components beyond presentation.

Forbidden:
- `fetch(...)` inside a `.tsx` component.
- `useState` for app state (use Redux). Local UI state (input value, hover) is OK.
- Business decisions in JSX.

## Run

```bash
npm install
npm run db:up
npm run -w apps/server prisma:generate
npm run -w apps/server prisma:migrate
npm run dev          # both workspaces
npm test             # both workspaces
```

Backend: http://localhost:3500/api/health
Frontend: http://localhost:5173
"""

# ─── apps/server ────────────────────────────────────────────────────────────

FILES["apps/server/package.json"] = """{
  "name": "@app/server",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.10",
    "@nestjs/core": "^10.3.10",
    "@nestjs/platform-express": "^10.3.10",
    "@prisma/client": "^5.18.0",
    "helmet": "^7.1.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.4",
    "@nestjs/testing": "^10.3.10",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.18.0",
    "supertest": "^7.0.0",
    "typescript": "^5.5.4",
    "vitest": "^1.6.0"
  }
}
"""

FILES["apps/server/tsconfig.json"] = """{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "outDir": "dist",
    "declaration": false,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["node"]
  },
  "include": ["src", "test"]
}
"""

FILES["apps/server/nest-cli.json"] = """{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
"""

FILES["apps/server/vitest.config.ts"] = """import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globals: true,
  },
});
"""

FILES["apps/server/prisma/schema.prisma"] = """// Prisma schema. Add models per feature.
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Placeholder so `prisma generate` produces a client at skeleton stage.
// Replace / extend per feature (see apps/server/AGENT.md).
model AppMeta {
  id        Int      @id @default(autoincrement())
  key       String   @unique
  value     String
  updatedAt DateTime @updatedAt
}

// __FEATURE_MODELS__
"""

FILES["apps/server/AGENT.md"] = """# apps/server

NestJS + Prisma + Postgres. Strict 4-layer architecture per feature.

```
src/
  main.ts                — bootstrap
  app.module.ts          — root module
  config/env.ts          — zod-validated env
  db/prisma.module.ts    — global Prisma provider
  db/prisma.service.ts   — Prisma client wrapper
  health/                — example feature (see layers)
    controller.ts
    service.ts
    logic.ts
    module.ts
    *.spec.ts
```

## Adding a feature

1. Create `src/<feature>/`.
2. Define `dto.ts` with zod schemas.
3. Write `logic.ts` (pure). Test it.
4. Write `repository.ts` if it touches DB.
5. Write `service.ts` orchestrating logic+repo.
6. Write `controller.ts` calling service.
7. Wire in `module.ts`. Import in `app.module.ts`.
8. Add migration: `npm run prisma:migrate -- --name <feature>`.

## Forbidden
- Prisma access from controllers/services without going through repository.
- Logic in controllers (validate + delegate only).
- IO inside `logic.ts`.
"""

FILES["apps/server/src/main.ts"] = """import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true, credentials: true });
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`[server] listening :${env.PORT}`);
}
bootstrap();
"""

FILES["apps/server/src/app.module.ts"] = """import { Module } from '@nestjs/common';
import { PrismaModule } from './db/prisma.module';
import { HealthModule } from './health/module';
/* __FEATURE_MODULE_IMPORTS__ */

@Module({
  imports: [PrismaModule, HealthModule, /* __FEATURE_MODULES__ */],
})
export class AppModule {}
"""

FILES["apps/server/src/config/env.ts"] = """import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3500),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(8),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('[env] invalid:', parsed.error.flatten().fieldErrors);
    throw new Error('invalid env');
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvForTest() { cached = undefined; }
"""

FILES["apps/server/src/config/env.spec.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import { loadEnv, resetEnvForTest } from './env';

describe('loadEnv', () => {
  beforeEach(() => resetEnvForTest());

  it('parses a valid env', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '4000',
      DATABASE_URL: 'postgresql://a:b@h:1/d',
      JWT_SECRET: 'longenough',
    } as any);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('test');
  });

  it('throws on missing DATABASE_URL', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'longenough' } as any),
    ).toThrow(/invalid env/);
  });

  it('throws on weak JWT_SECRET', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgresql://a:b@h:1/d', JWT_SECRET: 'x' } as any),
    ).toThrow();
  });
});
"""

FILES["apps/server/src/db/prisma.module.ts"] = """import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
"""

FILES["apps/server/src/db/prisma.service.ts"] = """import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
"""

# ─── apps/server: health feature (reference layered impl) ───────────────────

FILES["apps/server/src/health/dto.ts"] = """import { z } from 'zod';

export const HealthResponse = z.object({
  ok: z.literal(true),
  uptime: z.number().nonnegative(),
  ts: z.number().int(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
"""

FILES["apps/server/src/health/logic.ts"] = """// PURE. No IO. No Nest. No Prisma.
import type { HealthResponse } from './dto';

export function buildHealth(now: number, startedAt: number): HealthResponse {
  return { ok: true, uptime: Math.max(0, now - startedAt), ts: now };
}
"""

FILES["apps/server/src/health/logic.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { buildHealth } from './logic';

describe('health/logic.buildHealth', () => {
  it('computes positive uptime', () => {
    const r = buildHealth(2000, 500);
    expect(r).toEqual({ ok: true, uptime: 1500, ts: 2000 });
  });
  it('clamps uptime to 0 if clock skew', () => {
    const r = buildHealth(100, 500);
    expect(r.uptime).toBe(0);
  });
});
"""

FILES["apps/server/src/health/service.ts"] = """import { Injectable } from '@nestjs/common';
import { buildHealth } from './logic';
import type { HealthResponse } from './dto';

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  get(): HealthResponse {
    return buildHealth(Date.now(), this.startedAt);
  }
}
"""

FILES["apps/server/src/health/controller.ts"] = """import { Controller, Get } from '@nestjs/common';
import { HealthService } from './service';
import type { HealthResponse } from './dto';

@Controller('health')
export class HealthController {
  constructor(private readonly svc: HealthService) {}

  @Get()
  get(): HealthResponse {
    return this.svc.get();
  }
}
"""

FILES["apps/server/src/health/module.ts"] = """import { Module } from '@nestjs/common';
import { HealthController } from './controller';
import { HealthService } from './service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
"""

FILES["apps/server/src/health/controller.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { HealthController } from './controller';
import { HealthService } from './service';

// Direct constructor wiring keeps this spec independent of decorator metadata
// (vitest does not emit it). The full IoC graph is covered by Nest at runtime.
describe('HealthController', () => {
  it('returns ok=true with uptime', () => {
    const ctrl = new HealthController(new HealthService());
    const r = ctrl.get();
    expect(r.ok).toBe(true);
    expect(r.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof r.ts).toBe('number');
  });
});
"""

# ─── apps/web ───────────────────────────────────────────────────────────────

FILES["apps/web/package.json"] = """{
  "name": "@app/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@reduxjs/toolkit": "^2.2.7",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "lucide-react": "^0.439.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-redux": "^9.1.2",
    "tailwind-merge": "^2.5.2",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^20.14.10",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "jsdom": "^24.1.1",
    "postcss": "^8.4.41",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
"""

FILES["apps/web/postcss.config.js"] = """export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
"""

FILES["apps/web/tailwind.config.ts"] = """import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [animate],
};
export default config;
"""

FILES["apps/web/src/index.css"] = """@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}
"""

FILES["apps/web/src/lib/utils.ts"] = """import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
"""

FILES["apps/web/src/components/ui/button.tsx"] = """import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
"""

FILES["apps/web/src/components/ui/input.tsx"] = """import * as React from 'react';
import { cn } from '../../lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
"""

FILES["apps/web/src/components/ui/label.tsx"] = """import * as React from 'react';
import { cn } from '../../lib/utils';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = 'Label';
"""

FILES["apps/web/src/components/ui/card.tsx"] = """import * as React from 'react';
import { cn } from '../../lib/utils';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-2xl font-semibold leading-none tracking-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
"""

FILES["apps/web/tsconfig.json"] = """{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
"""

FILES["apps/web/vite.config.ts"] = """import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3500', changeOrigin: true },
    },
  },
});
"""

FILES["apps/web/vitest.config.ts"] = """import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
"""

FILES["apps/web/index.html"] = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"""

FILES["apps/web/AGENT.md"] = """# apps/web

React + Redux Toolkit + Vite + Tailwind + shadcn-style UI.
ALL app logic lives in Redux, never in components.

```
src/
  main.tsx                  — bootstrap, Provider, imports index.css
  App.tsx                   — root layout
  index.css                 — tailwind directives + CSS vars (light/dark theme)
  lib/utils.ts              — cn() helper (clsx + tailwind-merge)
  app/
    store.ts                — configureStore + RootState/AppDispatch types
    hooks.ts                — typed useAppSelector / useAppDispatch
    rootReducer.ts          — combineReducers
  features/
    health/                 — example feature
      Slice.ts
      Thunks.ts
      Api.ts
      Selectors.ts
      Slice.test.ts
  components/
    ui/                     — shadcn-style primitives (Button, Input, Label, Card)
    *.tsx                   — feature components (DUMB, dispatch+select only)
  setupTests.ts             — jest-dom matchers
```

## Styling
- Tailwind utility classes everywhere. No CSS-in-JS, no inline `style={{}}` for theming.
- Reuse `components/ui/*` shadcn primitives. Add new ones in `components/ui/` following the same forwardRef pattern.
- Theme tokens live in `index.css` (`--primary`, `--muted`, ...). Reference via `text-primary`, `bg-card`, etc.
- Dark mode via `class="dark"` on `<html>` (toggle via theme slice when added).

## Adding a feature

1. Create `src/features/<feature>/`.
2. `Api.ts` — fetch wrappers. Returns plain DTOs.
3. `Slice.ts` — state machine (status, data, error). Reducers. Pure.
4. `Thunks.ts` — `createAsyncThunk` calling Api, dispatching Slice actions.
5. `Selectors.ts` — derived state.
6. `Slice.test.ts` — pure reducer tests.
7. Register reducer in `app/rootReducer.ts`.
8. Components dispatch thunks via `useAppDispatch`, read via `useAppSelector(selector)`.

## Forbidden
- `fetch()` inside a `.tsx`.
- `useState` for app state (only ephemeral UI state allowed: input value, dropdown open).
- Business logic in JSX (move to Slice/Selectors).
- Direct DOM access except for portals/refs to native widgets.
"""

FILES["apps/web/src/setupTests.ts"] = """import '@testing-library/jest-dom/vitest';
"""

FILES["apps/web/src/main.tsx"] = """import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './app/store';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
);
"""

FILES["apps/web/src/App.tsx"] = """import { HealthStatus } from './components/HealthStatus';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';

export function App() {
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">App</h1>
        <Card>
          <CardHeader>
            <CardTitle>Server status</CardTitle>
          </CardHeader>
          <CardContent>
            <HealthStatus />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
"""

FILES["apps/web/src/app/store.ts"] = """import { configureStore } from '@reduxjs/toolkit';
import { rootReducer } from './rootReducer';

export const store = configureStore({ reducer: rootReducer });

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
"""

FILES["apps/web/src/app/rootReducer.ts"] = """import { combineReducers } from '@reduxjs/toolkit';
import healthReducer from '../features/health/Slice';
/* __FEATURE_REDUCER_IMPORTS__ */

export const rootReducer = combineReducers({
  health: healthReducer,
  /* __FEATURE_REDUCERS__ */
});
"""

FILES["apps/web/src/app/hooks.ts"] = """import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from './store';

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
"""

# ─── apps/web: health feature (reference Redux impl) ────────────────────────

FILES["apps/web/src/features/health/Api.ts"] = """export type HealthDto = { ok: true; uptime: number; ts: number };

export async function fetchHealth(signal?: AbortSignal): Promise<HealthDto> {
  const res = await fetch('/api/health', { signal });
  if (!res.ok) throw new Error(`health http ${res.status}`);
  return (await res.json()) as HealthDto;
}
"""

FILES["apps/web/src/features/health/Slice.ts"] = """import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { loadHealth } from './Thunks';
import type { HealthDto } from './Api';

export type Status = 'idle' | 'loading' | 'ok' | 'error';

export interface HealthState {
  status: Status;
  data: HealthDto | null;
  error: string | null;
}

const initialState: HealthState = { status: 'idle', data: null, error: null };

const slice = createSlice({
  name: 'health',
  initialState,
  reducers: {
    reset: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(loadHealth.pending, (s) => {
      s.status = 'loading';
      s.error = null;
    });
    b.addCase(loadHealth.fulfilled, (s, a: PayloadAction<HealthDto>) => {
      s.status = 'ok';
      s.data = a.payload;
    });
    b.addCase(loadHealth.rejected, (s, a) => {
      s.status = 'error';
      s.error = a.error.message ?? 'unknown';
    });
  },
});

export const { reset } = slice.actions;
export default slice.reducer;
"""

FILES["apps/web/src/features/health/Thunks.ts"] = """import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchHealth, type HealthDto } from './Api';

export const loadHealth = createAsyncThunk<HealthDto>(
  'health/load',
  async (_, { signal }) => fetchHealth(signal),
);
"""

FILES["apps/web/src/features/health/Selectors.ts"] = """import type { RootState } from '../../app/store';

export const selectHealthStatus = (s: RootState) => s.health.status;
export const selectHealthUptime = (s: RootState) => s.health.data?.uptime ?? 0;
export const selectHealthError = (s: RootState) => s.health.error;
"""

FILES["apps/web/src/features/health/Slice.test.ts"] = """import { describe, it, expect } from 'vitest';
import reducer, { reset } from './Slice';
import { loadHealth } from './Thunks';

describe('health Slice', () => {
  const initial = reducer(undefined, { type: '@@INIT' });

  it('initial is idle', () => {
    expect(initial.status).toBe('idle');
    expect(initial.data).toBeNull();
  });

  it('handles pending', () => {
    const s = reducer(initial, { type: loadHealth.pending.type });
    expect(s.status).toBe('loading');
    expect(s.error).toBeNull();
  });

  it('handles fulfilled', () => {
    const s = reducer(initial, {
      type: loadHealth.fulfilled.type,
      payload: { ok: true, uptime: 5, ts: 123 },
    });
    expect(s.status).toBe('ok');
    expect(s.data?.uptime).toBe(5);
  });

  it('handles rejected', () => {
    const s = reducer(initial, {
      type: loadHealth.rejected.type,
      error: { message: 'boom' },
    });
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('reset returns to initial', () => {
    const dirty = reducer(initial, {
      type: loadHealth.fulfilled.type,
      payload: { ok: true, uptime: 5, ts: 123 },
    });
    expect(reducer(dirty, reset()).status).toBe('idle');
  });
});
"""

FILES["apps/web/src/components/HealthStatus.tsx"] = """import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { loadHealth } from '../features/health/Thunks';
import {
  selectHealthStatus,
  selectHealthUptime,
  selectHealthError,
} from '../features/health/Selectors';

export function HealthStatus() {
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectHealthStatus);
  const uptime = useAppSelector(selectHealthUptime);
  const error = useAppSelector(selectHealthError);

  useEffect(() => {
    const p = dispatch(loadHealth());
    return () => p.abort();
  }, [dispatch]);

  if (status === 'loading' || status === 'idle')
    return <p className="text-muted-foreground">checking…</p>;
  if (status === 'error')
    return <p className="text-destructive">down: {error}</p>;
  return (
    <p className="text-emerald-600">
      healthy — uptime {Math.round(uptime / 1000)}s
    </p>
  );
}
"""

# ─── FEATURES ───────────────────────────────────────────────────────────────

FEATURES: dict[str, dict] = {}

# ─── auth feature ───────────────────────────────────────────────────────────

_AUTH_FILES: dict[str, str] = {}

_AUTH_FILES["apps/server/src/auth/dto.ts"] = """import { z } from 'zod';

export const SignupDto = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type SignupDto = z.infer<typeof SignupDto>;

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginDto>;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
};
export type AuthResponse = { token: string; user: PublicUser };
"""

_AUTH_FILES["apps/server/src/auth/logic.ts"] = """// PURE. node:crypto only (no IO, no Nest, no Prisma).
import * as crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validatePassword(pwd: string): string[] {
  const errs: string[] = [];
  if (pwd.length < 8) errs.push('password too short (min 8)');
  if (pwd.length > 256) errs.push('password too long');
  return errs;
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const derived = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  return crypto.timingSafeEqual(derived, expected);
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

export function signToken(sub: string, secret: string, expSec = 7 * 24 * 3600, now = Date.now()): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(now / 1000);
  const body: JwtPayload = { sub, iat, exp: iat + expSec };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as JwtPayload;
    if (typeof body.exp !== 'number' || body.exp < Math.floor(now / 1000)) return null;
    if (typeof body.sub !== 'string' || !body.sub) return null;
    return body;
  } catch {
    return null;
  }
}
"""

_AUTH_FILES["apps/server/src/auth/logic.spec.ts"] = """import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  normalizeEmail,
  validatePassword,
} from './logic';

describe('auth/logic — password', () => {
  it('hash + verify roundtrips', () => {
    const h = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });

  it('rejects malformed hash', () => {
    expect(verifyPassword('x', 'plain')).toBe(false);
    expect(verifyPassword('x', 'sha1$a$b')).toBe(false);
  });

  it('different hashes for same password (salted)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});

describe('auth/logic — token', () => {
  it('signs + verifies a token', () => {
    const t = signToken('user-1', 'secret-secret', 60);
    const p = verifyToken(t, 'secret-secret');
    expect(p?.sub).toBe('user-1');
  });

  it('rejects bad signature', () => {
    const t = signToken('user-1', 'secret-secret', 60);
    expect(verifyToken(t, 'other-secret')).toBeNull();
  });

  it('rejects expired token', () => {
    const t = signToken('user-1', 'secret-secret', 60, Date.now() - 120_000);
    expect(verifyToken(t, 'secret-secret')).toBeNull();
  });

  it('rejects malformed token', () => {
    expect(verifyToken('not-a-jwt', 'secret-secret')).toBeNull();
    expect(verifyToken('a.b', 'secret-secret')).toBeNull();
  });
});

describe('auth/logic — helpers', () => {
  it('normalizeEmail lowercases + trims', () => {
    expect(normalizeEmail('  Foo@BAR.com  ')).toBe('foo@bar.com');
  });

  it('validatePassword flags short', () => {
    expect(validatePassword('short')).toContain('password too short (min 8)');
    expect(validatePassword('longenough')).toEqual([]);
  });
});
"""

_AUTH_FILES["apps/server/src/auth/repository.ts"] = """import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly db: PrismaService) {}

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  create(data: { email: string; passwordHash: string; role?: string }) {
    return this.db.user.create({ data });
  }

  count(): Promise<number> {
    return this.db.user.count();
  }
}
"""

_AUTH_FILES["apps/server/src/auth/service.ts"] = """import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthRepository } from './repository';
import {
  hashPassword,
  normalizeEmail,
  signToken,
  validatePassword,
  verifyPassword,
  verifyToken,
} from './logic';
import type { AuthResponse, PublicUser } from './dto';
import { loadEnv } from '../config/env';

@Injectable()
export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  private secret(): string {
    return loadEnv().JWT_SECRET;
  }

  private toPublic(u: {
    id: string; email: string; name: string; role: string; createdAt: Date;
  }): PublicUser {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    };
  }

  async signup(input: { email: string; password: string }): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    const errs = validatePassword(input.password);
    if (errs.length) throw new BadRequestException(errs.join('; '));
    const exists = await this.repo.findByEmail(email);
    if (exists) throw new BadRequestException('email already registered');
    const passwordHash = hashPassword(input.password);
    const isFirst = (await this.repo.count()) === 0;
    const u = await this.repo.create({
      email,
      passwordHash,
      role: isFirst ? 'admin' : 'user',
    });
    return { token: signToken(u.id, this.secret()), user: this.toPublic(u) };
  }

  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    const u = await this.repo.findByEmail(email);
    if (!u) throw new UnauthorizedException('invalid credentials');
    if (!verifyPassword(input.password, u.passwordHash)) {
      throw new UnauthorizedException('invalid credentials');
    }
    return { token: signToken(u.id, this.secret()), user: this.toPublic(u) };
  }

  async getMe(userId: string): Promise<PublicUser> {
    const u = await this.repo.findById(userId);
    if (!u) throw new UnauthorizedException('user gone');
    return this.toPublic(u);
  }

  validateToken(token: string): string | null {
    const p = verifyToken(token, this.secret());
    return p?.sub ?? null;
  }
}
"""

_AUTH_FILES["apps/server/src/auth/guard.ts"] = """import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './service';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing token');
    }
    const token = header.slice('Bearer '.length).trim();
    const sub = this.auth.validateToken(token);
    if (!sub) throw new UnauthorizedException('bad token');
    req.userId = sub;
    return true;
  }
}
"""

_AUTH_FILES["apps/server/src/auth/controller.ts"] = """import { Body, Controller, Get, Post, Req, UseGuards, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AuthService } from './service';
import { JwtGuard } from './guard';
import { LoginDto, SignupDto, type AuthResponse, type PublicUser } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Post('signup')
  @UsePipes(new ZodValidationPipe(SignupDto))
  signup(@Body() body: SignupDto): Promise<AuthResponse> {
    return this.svc.signup(body);
  }

  @Post('login')
  @UsePipes(new ZodValidationPipe(LoginDto))
  login(@Body() body: LoginDto): Promise<AuthResponse> {
    return this.svc.login(body);
  }

  @Get('me')
  @UseGuards(JwtGuard)
  me(@Req() req: { userId: string }): Promise<PublicUser> {
    return this.svc.getMe(req.userId);
  }
}
"""

_AUTH_FILES["apps/server/src/auth/module.ts"] = """import { Module } from '@nestjs/common';
import { AuthController } from './controller';
import { AuthService } from './service';
import { AuthRepository } from './repository';
import { JwtGuard } from './guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, JwtGuard],
  exports: [AuthService, JwtGuard],
})
export class AuthModule {}
"""

_AUTH_FILES["apps/server/src/auth/controller.spec.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import { AuthController } from './controller';
import { AuthService } from './service';
import type { AuthRepository } from './repository';
import { resetEnvForTest } from '../config/env';

class FakeRepo {
  store = new Map<string, any>();
  byId = new Map<string, any>();
  async findByEmail(email: string) { return this.store.get(email) ?? null; }
  async findById(id: string) { return this.byId.get(id) ?? null; }
  async create(data: { email: string; passwordHash: string; role?: string }) {
    const u = {
      id: `u-${this.store.size + 1}`,
      ...data,
      name: '',
      role: data.role ?? 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(data.email, u);
    this.byId.set(u.id, u);
    return u;
  }
  async count() { return this.store.size; }
}

describe('AuthController', () => {
  beforeEach(() => {
    resetEnvForTest();
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3500';
    process.env.DATABASE_URL = 'postgresql://u:p@h:1/d';
    process.env.JWT_SECRET = 'unit-test-secret-very-long';
  });

  it('signup → login roundtrip', async () => {
    const repo = new FakeRepo();
    const svc = new AuthService(repo as unknown as AuthRepository);
    const ctrl = new AuthController(svc);
    const r1 = await ctrl.signup({ email: 'a@b.co', password: 'longenough' });
    expect(r1.user.email).toBe('a@b.co');
    expect(r1.user.role).toBe('admin');
    const r3 = await ctrl.signup({ email: 'b@b.co', password: 'longenough' });
    expect(r3.user.role).toBe('user');
    expect(r1.token).toMatch(/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/);
    const r2 = await ctrl.login({ email: 'a@b.co', password: 'longenough' });
    expect(r2.user.id).toBe(r1.user.id);
  });

  it('signup rejects duplicate email', async () => {
    const repo = new FakeRepo();
    const ctrl = new AuthController(new AuthService(repo as unknown as AuthRepository));
    await ctrl.signup({ email: 'a@b.co', password: 'longenough' });
    await expect(ctrl.signup({ email: 'a@b.co', password: 'longenough' }))
      .rejects.toThrow(/already registered/);
  });

  it('login rejects bad password', async () => {
    const repo = new FakeRepo();
    const ctrl = new AuthController(new AuthService(repo as unknown as AuthRepository));
    await ctrl.signup({ email: 'a@b.co', password: 'longenough' });
    await expect(ctrl.login({ email: 'a@b.co', password: 'wrong-pwd' }))
      .rejects.toThrow(/invalid credentials/);
  });

  it('me returns user from token sub', async () => {
    const repo = new FakeRepo();
    const svc = new AuthService(repo as unknown as AuthRepository);
    const ctrl = new AuthController(svc);
    const r = await ctrl.signup({ email: 'a@b.co', password: 'longenough' });
    const sub = svc.validateToken(r.token);
    expect(sub).toBe(r.user.id);
    const me = await ctrl.me({ userId: sub! });
    expect(me.email).toBe('a@b.co');
  });
});
"""

# Shared zod pipe used by feature controllers. Lives under common/.
_AUTH_FILES["apps/server/src/common/zod.pipe.ts"] = """import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException(r.error.flatten().fieldErrors);
    }
    return r.data;
  }
}
"""

# Web auth files
_AUTH_FILES["apps/web/src/features/auth/Api.ts"] = """export type PublicUser = { id: string; email: string; name: string; role: string; createdAt: string };
export type AuthResponse = { token: string; user: PublicUser };

async function jsonOrThrow(res: Response): Promise<any> {
  if (!res.ok) {
    let msg = `http ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.message === 'string') msg = body.message;
      else if (body?.message) msg = JSON.stringify(body.message);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function apiSignup(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return jsonOrThrow(res);
}

export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return jsonOrThrow(res);
}

export async function apiMe(token: string): Promise<PublicUser> {
  const res = await fetch('/api/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  return jsonOrThrow(res);
}
"""

_AUTH_FILES["apps/web/src/features/auth/Slice.ts"] = """import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { signupThunk, loginThunk, loadMeThunk } from './Thunks';
import type { AuthResponse, PublicUser } from './Api';

export type AuthStatus = 'idle' | 'loading' | 'authed' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  token: string | null;
  error: string | null;
}

const TOKEN_KEY = 'app.auth.token';

function readPersisted(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

const initialState: AuthState = {
  status: readPersisted() ? 'loading' : 'idle',
  user: null,
  token: readPersisted(),
  error: null,
};

const slice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      state.status = 'idle';
      state.user = null;
      state.token = null;
      state.error = null;
      if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (b) => {
    const setAuthed = (state: AuthState, action: PayloadAction<AuthResponse>) => {
      state.status = 'authed';
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.error = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TOKEN_KEY, action.payload.token);
      }
    };
    b.addCase(signupThunk.pending, (s) => { s.status = 'loading'; s.error = null; });
    b.addCase(signupThunk.fulfilled, setAuthed);
    b.addCase(signupThunk.rejected, (s, a) => {
      s.status = 'error';
      s.error = a.error.message ?? 'signup failed';
    });
    b.addCase(loginThunk.pending, (s) => { s.status = 'loading'; s.error = null; });
    b.addCase(loginThunk.fulfilled, setAuthed);
    b.addCase(loginThunk.rejected, (s, a) => {
      s.status = 'error';
      s.error = a.error.message ?? 'login failed';
    });
    b.addCase(loadMeThunk.fulfilled, (s, a: PayloadAction<PublicUser>) => {
      s.status = 'authed';
      s.user = a.payload;
    });
    b.addCase(loadMeThunk.rejected, (s) => {
      s.status = 'idle';
      s.user = null;
      s.token = null;
      if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
    });
  },
});

export const { logout, clearError } = slice.actions;
export default slice.reducer;
"""

_AUTH_FILES["apps/web/src/features/auth/Thunks.ts"] = """import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiLogin, apiMe, apiSignup, type AuthResponse, type PublicUser } from './Api';
import type { RootState } from '../../app/store';

export const signupThunk = createAsyncThunk<AuthResponse, { email: string; password: string }>(
  'auth/signup',
  async ({ email, password }) => apiSignup(email, password),
);

export const loginThunk = createAsyncThunk<AuthResponse, { email: string; password: string }>(
  'auth/login',
  async ({ email, password }) => apiLogin(email, password),
);

export const loadMeThunk = createAsyncThunk<PublicUser, void, { state: RootState }>(
  'auth/me',
  async (_, { getState }) => {
    const token = getState().auth.token;
    if (!token) throw new Error('no token');
    return apiMe(token);
  },
);
"""

_AUTH_FILES["apps/web/src/features/auth/Selectors.ts"] = """import type { RootState } from '../../app/store';

export const selectAuthStatus = (s: RootState) => s.auth.status;
export const selectAuthUser = (s: RootState) => s.auth.user;
export const selectAuthToken = (s: RootState) => s.auth.token;
export const selectAuthError = (s: RootState) => s.auth.error;
export const selectIsAuthed = (s: RootState) => s.auth.status === 'authed' && !!s.auth.user;
"""

_AUTH_FILES["apps/web/src/features/auth/Slice.test.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import reducer, { logout, clearError } from './Slice';
import { loginThunk, signupThunk, loadMeThunk } from './Thunks';

const sample = { token: 'tok', user: { id: 'u1', email: 'a@b.co', name: '', role: 'user', createdAt: 'now' } };

describe('auth Slice', () => {
  beforeEach(() => localStorage.clear());

  it('initial idle when no persisted token', () => {
    const s = reducer(undefined, { type: '@@INIT' });
    expect(s.status).toBe('idle');
    expect(s.token).toBeNull();
  });

  it('login.fulfilled stores user+token, persists to localStorage', () => {
    const initial = reducer(undefined, { type: '@@INIT' });
    const s = reducer(initial, { type: loginThunk.fulfilled.type, payload: sample });
    expect(s.status).toBe('authed');
    expect(s.user?.id).toBe('u1');
    expect(s.token).toBe('tok');
    expect(localStorage.getItem('app.auth.token')).toBe('tok');
  });

  it('login.rejected sets error', () => {
    const s = reducer(undefined, { type: loginThunk.rejected.type, error: { message: 'bad' } });
    expect(s.status).toBe('error');
    expect(s.error).toBe('bad');
  });

  it('signup.fulfilled also authenticates', () => {
    const s = reducer(undefined, { type: signupThunk.fulfilled.type, payload: sample });
    expect(s.status).toBe('authed');
  });

  it('logout clears state and storage', () => {
    const authed = reducer(undefined, { type: loginThunk.fulfilled.type, payload: sample });
    const s = reducer(authed, logout());
    expect(s.status).toBe('idle');
    expect(s.user).toBeNull();
    expect(s.token).toBeNull();
    expect(localStorage.getItem('app.auth.token')).toBeNull();
  });

  it('clearError resets error only', () => {
    const errored = reducer(undefined, { type: loginThunk.rejected.type, error: { message: 'x' } });
    const s = reducer(errored, clearError());
    expect(s.error).toBeNull();
  });

  it('loadMe.rejected when token stale wipes auth', () => {
    const authed = reducer(undefined, { type: loginThunk.fulfilled.type, payload: sample });
    const s = reducer(authed, { type: loadMeThunk.rejected.type, error: { message: 'gone' } });
    expect(s.status).toBe('idle');
    expect(s.token).toBeNull();
  });
});
"""

_AUTH_FILES["apps/web/src/components/LoginForm.tsx"] = """import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { loginThunk } from '../features/auth/Thunks';
import { selectAuthError, selectAuthStatus } from '../features/auth/Selectors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface Props {
  onSwitchToSignup?: () => void;
}

export function LoginForm({ onSwitchToSignup }: Props) {
  // Local input state is OK (ephemeral UI). App state stays in Redux.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectAuthStatus);
  const error = useAppSelector(selectAuthError);
  const busy = status === 'loading';

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your credentials</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            dispatch(loginThunk({ email, password }));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-pwd">Password</Label>
            <Input
              id="login-pwd"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          {onSwitchToSignup && (
            <Button type="button" variant="link" className="w-full" onClick={onSwitchToSignup}>
              No account? Sign up
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
"""

_AUTH_FILES["apps/web/src/components/SignupForm.tsx"] = """import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { signupThunk } from '../features/auth/Thunks';
import { selectAuthError, selectAuthStatus } from '../features/auth/Selectors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface Props {
  onSwitchToLogin?: () => void;
}

export function SignupForm({ onSwitchToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectAuthStatus);
  const error = useAppSelector(selectAuthError);
  const busy = status === 'loading';

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>It's free.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            dispatch(signupThunk({ email, password }));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-pwd">Password</Label>
            <Input
              id="signup-pwd"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
          {onSwitchToLogin && (
            <Button type="button" variant="link" className="w-full" onClick={onSwitchToLogin}>
              Already have one? Sign in
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
"""

_AUTH_FILES["apps/web/src/App.tsx"] = """import { HealthStatus } from './components/HealthStatus';
import { AuthGate } from './components/AuthGate';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { useAppDispatch, useAppSelector } from './app/hooks';
import { logout } from './features/auth/Slice';
import { selectAuthUser } from './features/auth/Selectors';
/* __APP_FEATURE_IMPORTS__ */

function Dashboard() {
  const user = useAppSelector(selectAuthUser);
  const dispatch = useAppDispatch();
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold tracking-tight">App</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => dispatch(logout())}>
              Logout
            </Button>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Server status</CardTitle>
          </CardHeader>
          <CardContent>
            <HealthStatus />
          </CardContent>
        </Card>
        {/* __APP_FEATURE_PANELS__ */}
      </div>
      {/* __APP_FEATURE_OVERLAYS__ */}
    </main>
  );
}

export function App() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  );
}
"""

_AUTH_FILES["apps/web/src/components/AuthGate.tsx"] = """import { useEffect, useState, type ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { loadMeThunk } from '../features/auth/Thunks';
import { selectAuthToken, selectIsAuthed, selectAuthStatus } from '../features/auth/Selectors';
import { LoginForm } from './LoginForm';
import { SignupForm } from './SignupForm';

interface Props { children: ReactNode }

export function AuthGate({ children }: Props) {
  const dispatch = useAppDispatch();
  const token = useAppSelector(selectAuthToken);
  const isAuthed = useAppSelector(selectIsAuthed);
  const status = useAppSelector(selectAuthStatus);
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  useEffect(() => {
    if (token && !isAuthed) dispatch(loadMeThunk());
  }, [token, isAuthed, dispatch]);

  if (token && status === 'loading') {
    return <p className="text-muted-foreground p-8">Loading session…</p>;
  }
  if (!isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        {mode === 'login'
          ? <LoginForm onSwitchToSignup={() => setMode('signup')} />
          : <SignupForm onSwitchToLogin={() => setMode('login')} />}
      </div>
    );
  }
  return <>{children}</>;
}
"""

FEATURES["auth"] = {
    "files": _AUTH_FILES,
    "prisma_models": """model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String   @default("")
  role         String   @default("user")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
""",
    "server_imports": "import { AuthModule } from './auth/module';",
    "server_modules": "AuthModule",
    "web_reducer_imports": "import authReducer from '../features/auth/Slice';",
    "web_reducers": "auth: authReducer",
}


# ─── users feature ──────────────────────────────────────────────────────────

_USERS_FILES: dict[str, str] = {}

_USERS_FILES["apps/server/src/users/dto.ts"] = """import { z } from 'zod';

export const UpdateProfileDto = z.object({
  name: z.string().min(1).max(80),
});
export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;

export const AdminUpdateUserDto = z.object({
  name: z.string().min(1).max(80).optional(),
  role: z.enum(['user', 'admin']).optional(),
});
export type AdminUpdateUserDto = z.infer<typeof AdminUpdateUserDto>;

export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.infer<typeof ListQuery>;

export type UserDto = {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
};

export type UserListResponse = {
  items: UserDto[];
  total: number;
  page: number;
  pageSize: number;
};
"""

_USERS_FILES["apps/server/src/users/logic.ts"] = """// PURE.
import type { UserDto } from './dto';

export function isAdmin(role: string): boolean {
  return role === 'admin';
}

export function sanitizeName(raw: string): string {
  return raw.trim().replace(/\\s+/g, ' ');
}

export function toUserDto(u: {
  id: string; email: string; name: string; role: string; createdAt: Date;
}): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize };
}
"""

_USERS_FILES["apps/server/src/users/logic.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { isAdmin, sanitizeName, toUserDto } from './logic';

describe('users/logic', () => {
  it('isAdmin', () => {
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('user')).toBe(false);
    expect(isAdmin('')).toBe(false);
  });

  it('sanitizeName collapses whitespace', () => {
    expect(sanitizeName('  John   Doe  ')).toBe('John Doe');
  });

  it('toUserDto serializes Date', () => {
    const d = new Date('2024-01-02T03:04:05Z');
    const dto = toUserDto({ id: '1', email: 'a@b', name: 'A', role: 'user', createdAt: d });
    expect(dto.createdAt).toBe('2024-01-02T03:04:05.000Z');
  });
});
"""

_USERS_FILES["apps/server/src/users/repository.ts"] = """import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly db: PrismaService) {}

  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  list(skip: number, take: number) {
    return this.db.user.findMany({
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    });
  }

  count() {
    return this.db.user.count();
  }

  updateName(id: string, name: string) {
    return this.db.user.update({ where: { id }, data: { name } });
  }

  adminUpdate(id: string, patch: { name?: string; role?: string }) {
    return this.db.user.update({ where: { id }, data: patch });
  }

  delete(id: string) {
    return this.db.user.delete({ where: { id } });
  }
}
"""

_USERS_FILES["apps/server/src/users/service.ts"] = """import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './repository';
import { isAdmin, paginate, sanitizeName, toUserDto } from './logic';
import type { AdminUpdateUserDto, UserDto, UserListResponse } from './dto';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  private async requireAdmin(actorId: string) {
    const actor = await this.repo.findById(actorId);
    if (!actor || !isAdmin(actor.role)) throw new ForbiddenException('admin only');
    return actor;
  }

  private async requireUser(id: string) {
    const u = await this.repo.findById(id);
    if (!u) throw new NotFoundException('user not found');
    return u;
  }

  async getProfile(actorId: string): Promise<UserDto> {
    const u = await this.requireUser(actorId);
    return toUserDto(u);
  }

  async updateProfile(actorId: string, name: string): Promise<UserDto> {
    await this.requireUser(actorId);
    const u = await this.repo.updateName(actorId, sanitizeName(name));
    return toUserDto(u);
  }

  async list(actorId: string, page: number, pageSize: number): Promise<UserListResponse> {
    await this.requireAdmin(actorId);
    const skip = (page - 1) * pageSize;
    const [rows, total] = await Promise.all([
      this.repo.list(skip, pageSize),
      this.repo.count(),
    ]);
    return paginate(rows.map(toUserDto), total, page, pageSize);
  }

  async adminUpdate(actorId: string, targetId: string, patch: AdminUpdateUserDto): Promise<UserDto> {
    await this.requireAdmin(actorId);
    await this.requireUser(targetId);
    const cleaned: { name?: string; role?: string } = {};
    if (patch.name !== undefined) cleaned.name = sanitizeName(patch.name);
    if (patch.role !== undefined) cleaned.role = patch.role;
    const u = await this.repo.adminUpdate(targetId, cleaned);
    return toUserDto(u);
  }

  async adminDelete(actorId: string, targetId: string): Promise<{ deleted: string }> {
    await this.requireAdmin(actorId);
    if (actorId === targetId) throw new ForbiddenException('cannot delete self');
    await this.requireUser(targetId);
    await this.repo.delete(targetId);
    return { deleted: targetId };
  }
}
"""

_USERS_FILES["apps/server/src/users/controller.ts"] = """import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod.pipe';
import { JwtGuard } from '../auth/guard';
import { UsersService } from './service';
import {
  AdminUpdateUserDto,
  ListQuery,
  UpdateProfileDto,
} from './dto';

@Controller('users')
@UseGuards(JwtGuard)
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get('me')
  me(@Req() req: { userId: string }) {
    return this.svc.getProfile(req.userId);
  }

  @Patch('me')
  @UsePipes(new ZodValidationPipe(UpdateProfileDto))
  updateMe(@Req() req: { userId: string }, @Body() body: UpdateProfileDto) {
    return this.svc.updateProfile(req.userId, body.name);
  }

  @Get()
  list(@Req() req: { userId: string }, @Query(new ZodValidationPipe(ListQuery)) q: ListQuery) {
    return this.svc.list(req.userId, q.page, q.pageSize);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(AdminUpdateUserDto))
  adminUpdate(
    @Req() req: { userId: string },
    @Param('id') id: string,
    @Body() body: AdminUpdateUserDto,
  ) {
    return this.svc.adminUpdate(req.userId, id, body);
  }

  @Delete(':id')
  adminDelete(@Req() req: { userId: string }, @Param('id') id: string) {
    return this.svc.adminDelete(req.userId, id);
  }
}
"""

_USERS_FILES["apps/server/src/users/module.ts"] = """import { Module } from '@nestjs/common';
import { UsersController } from './controller';
import { UsersService } from './service';
import { UsersRepository } from './repository';
import { AuthModule } from '../auth/module';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
"""

_USERS_FILES["apps/server/src/users/controller.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { UsersController } from './controller';
import { UsersService } from './service';
import type { UsersRepository } from './repository';

class FakeRepo {
  rows: Array<{ id: string; email: string; name: string; role: string; createdAt: Date }> = [];
  async findById(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async list(skip: number, take: number) { return this.rows.slice(skip, skip + take); }
  async count() { return this.rows.length; }
  async updateName(id: string, name: string) {
    const r = this.rows.find((x) => x.id === id)!;
    r.name = name;
    return r;
  }
  async adminUpdate(id: string, patch: { name?: string; role?: string }) {
    const r = this.rows.find((x) => x.id === id)!;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.role !== undefined) r.role = patch.role;
    return r;
  }
  async delete(id: string) {
    const i = this.rows.findIndex((x) => x.id === id);
    this.rows.splice(i, 1);
  }
}

function setup() {
  const repo = new FakeRepo();
  repo.rows.push(
    { id: 'admin-1', email: 'admin@x', name: 'A', role: 'admin', createdAt: new Date() },
    { id: 'user-1', email: 'u1@x', name: 'U1', role: 'user', createdAt: new Date() },
    { id: 'user-2', email: 'u2@x', name: 'U2', role: 'user', createdAt: new Date() },
  );
  const svc = new UsersService(repo as unknown as UsersRepository);
  return { svc, ctrl: new UsersController(svc), repo };
}

describe('UsersController', () => {
  it('me returns own profile', async () => {
    const { ctrl } = setup();
    const me = await ctrl.me({ userId: 'user-1' });
    expect(me.email).toBe('u1@x');
  });

  it('updateMe sanitizes name', async () => {
    const { ctrl } = setup();
    const r = await ctrl.updateMe({ userId: 'user-1' }, { name: '  Foo   Bar  ' });
    expect(r.name).toBe('Foo Bar');
  });

  it('list requires admin', async () => {
    const { ctrl } = setup();
    await expect(ctrl.list({ userId: 'user-1' }, { page: 1, pageSize: 20 } as any))
      .rejects.toThrow(/admin only/);
  });

  it('list returns paginated for admin', async () => {
    const { ctrl } = setup();
    const r = await ctrl.list({ userId: 'admin-1' }, { page: 1, pageSize: 20 } as any);
    expect(r.total).toBe(3);
    expect(r.items.length).toBe(3);
  });

  it('admin update + delete', async () => {
    const { ctrl, repo } = setup();
    await ctrl.adminUpdate({ userId: 'admin-1' }, 'user-1', { role: 'admin' });
    expect(repo.rows.find((r) => r.id === 'user-1')?.role).toBe('admin');
    await ctrl.adminDelete({ userId: 'admin-1' }, 'user-2');
    expect(repo.rows.find((r) => r.id === 'user-2')).toBeUndefined();
  });

  it('admin cannot delete self', async () => {
    const { ctrl } = setup();
    await expect(ctrl.adminDelete({ userId: 'admin-1' }, 'admin-1'))
      .rejects.toThrow(/cannot delete self/);
  });
});
"""

# Web users files
_USERS_FILES["apps/web/src/features/users/Api.ts"] = """import type { PublicUser } from '../auth/Api';

export type UserDto = PublicUser;
export type UserListResponse = {
  items: UserDto[];
  total: number;
  page: number;
  pageSize: number;
};

async function jsonOrThrow(res: Response): Promise<any> {
  if (!res.ok) {
    let msg = `http ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = typeof body.message === 'string' ? body.message : JSON.stringify(body.message);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export async function apiGetMyProfile(token: string): Promise<UserDto> {
  return jsonOrThrow(await fetch('/api/users/me', { headers: auth(token) }));
}

export async function apiUpdateMyProfile(token: string, name: string): Promise<UserDto> {
  return jsonOrThrow(
    await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth(token) },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function apiListUsers(token: string, page = 1, pageSize = 20): Promise<UserListResponse> {
  return jsonOrThrow(
    await fetch(`/api/users?page=${page}&pageSize=${pageSize}`, { headers: auth(token) }),
  );
}

export async function apiAdminUpdateUser(
  token: string,
  id: string,
  patch: { name?: string; role?: string },
): Promise<UserDto> {
  return jsonOrThrow(
    await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth(token) },
      body: JSON.stringify(patch),
    }),
  );
}

export async function apiAdminDeleteUser(token: string, id: string): Promise<{ deleted: string }> {
  return jsonOrThrow(
    await fetch(`/api/users/${id}`, { method: 'DELETE', headers: auth(token) }),
  );
}
"""

_USERS_FILES["apps/web/src/features/users/Slice.ts"] = """import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  loadProfileThunk,
  updateProfileThunk,
  loadUsersThunk,
  adminUpdateUserThunk,
  adminDeleteUserThunk,
} from './Thunks';
import type { UserDto, UserListResponse } from './Api';

export type AsyncStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface UsersState {
  profileStatus: AsyncStatus;
  profile: UserDto | null;
  listStatus: AsyncStatus;
  list: UserDto[];
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
}

const initialState: UsersState = {
  profileStatus: 'idle',
  profile: null,
  listStatus: 'idle',
  list: [],
  total: 0,
  page: 1,
  pageSize: 20,
  error: null,
};

const slice = createSlice({
  name: 'users',
  initialState,
  reducers: {
    reset: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(loadProfileThunk.pending, (s) => { s.profileStatus = 'loading'; s.error = null; });
    b.addCase(loadProfileThunk.fulfilled, (s, a: PayloadAction<UserDto>) => {
      s.profileStatus = 'ok';
      s.profile = a.payload;
    });
    b.addCase(loadProfileThunk.rejected, (s, a) => {
      s.profileStatus = 'error';
      s.error = a.error.message ?? 'profile load failed';
    });
    b.addCase(updateProfileThunk.fulfilled, (s, a: PayloadAction<UserDto>) => {
      s.profile = a.payload;
    });
    b.addCase(loadUsersThunk.pending, (s) => { s.listStatus = 'loading'; s.error = null; });
    b.addCase(loadUsersThunk.fulfilled, (s, a: PayloadAction<UserListResponse>) => {
      s.listStatus = 'ok';
      s.list = a.payload.items;
      s.total = a.payload.total;
      s.page = a.payload.page;
      s.pageSize = a.payload.pageSize;
    });
    b.addCase(loadUsersThunk.rejected, (s, a) => {
      s.listStatus = 'error';
      s.error = a.error.message ?? 'list failed';
    });
    b.addCase(adminUpdateUserThunk.fulfilled, (s, a: PayloadAction<UserDto>) => {
      const i = s.list.findIndex((u) => u.id === a.payload.id);
      if (i >= 0) s.list[i] = a.payload;
    });
    b.addCase(adminDeleteUserThunk.fulfilled, (s, a: PayloadAction<{ deleted: string }>) => {
      s.list = s.list.filter((u) => u.id !== a.payload.deleted);
      s.total = Math.max(0, s.total - 1);
    });
  },
});

export const { reset } = slice.actions;
export default slice.reducer;
"""

_USERS_FILES["apps/web/src/features/users/Thunks.ts"] = """import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  apiAdminDeleteUser,
  apiAdminUpdateUser,
  apiGetMyProfile,
  apiListUsers,
  apiUpdateMyProfile,
  type UserDto,
  type UserListResponse,
} from './Api';
import type { RootState } from '../../app/store';

function requireToken(state: RootState): string {
  const t = state.auth.token;
  if (!t) throw new Error('not authenticated');
  return t;
}

export const loadProfileThunk = createAsyncThunk<UserDto, void, { state: RootState }>(
  'users/profile/load',
  async (_, { getState }) => apiGetMyProfile(requireToken(getState())),
);

export const updateProfileThunk = createAsyncThunk<UserDto, { name: string }, { state: RootState }>(
  'users/profile/update',
  async ({ name }, { getState }) => apiUpdateMyProfile(requireToken(getState()), name),
);

export const loadUsersThunk = createAsyncThunk<
  UserListResponse,
  { page?: number; pageSize?: number } | void,
  { state: RootState }
>('users/list/load', async (q, { getState }) =>
  apiListUsers(requireToken(getState()), q?.page ?? 1, q?.pageSize ?? 20),
);

export const adminUpdateUserThunk = createAsyncThunk<
  UserDto,
  { id: string; patch: { name?: string; role?: string } },
  { state: RootState }
>('users/admin/update', async ({ id, patch }, { getState }) =>
  apiAdminUpdateUser(requireToken(getState()), id, patch),
);

export const adminDeleteUserThunk = createAsyncThunk<
  { deleted: string },
  { id: string },
  { state: RootState }
>('users/admin/delete', async ({ id }, { getState }) =>
  apiAdminDeleteUser(requireToken(getState()), id),
);
"""

_USERS_FILES["apps/web/src/features/users/Selectors.ts"] = """import type { RootState } from '../../app/store';

export const selectProfile = (s: RootState) => s.users.profile;
export const selectProfileStatus = (s: RootState) => s.users.profileStatus;
export const selectUsersList = (s: RootState) => s.users.list;
export const selectUsersTotal = (s: RootState) => s.users.total;
export const selectUsersPage = (s: RootState) => s.users.page;
export const selectUsersStatus = (s: RootState) => s.users.listStatus;
export const selectUsersError = (s: RootState) => s.users.error;
export const selectIsAdmin = (s: RootState) =>
  (s.auth.user?.role ?? s.users.profile?.role) === 'admin';
"""

_USERS_FILES["apps/web/src/features/users/Slice.test.ts"] = """import { describe, it, expect } from 'vitest';
import reducer, { reset } from './Slice';
import {
  loadProfileThunk,
  updateProfileThunk,
  loadUsersThunk,
  adminUpdateUserThunk,
  adminDeleteUserThunk,
} from './Thunks';

const u = (id: string, role = 'user') => ({
  id, email: `${id}@x`, name: id, role, createdAt: 'now',
});

describe('users Slice', () => {
  it('initial', () => {
    const s = reducer(undefined, { type: '@@INIT' });
    expect(s.profile).toBeNull();
    expect(s.list).toEqual([]);
  });

  it('loadProfile.fulfilled', () => {
    const s = reducer(undefined, { type: loadProfileThunk.fulfilled.type, payload: u('1') });
    expect(s.profile?.id).toBe('1');
    expect(s.profileStatus).toBe('ok');
  });

  it('updateProfile.fulfilled overwrites profile', () => {
    const a = reducer(undefined, { type: loadProfileThunk.fulfilled.type, payload: u('1') });
    const b = reducer(a, { type: updateProfileThunk.fulfilled.type, payload: { ...u('1'), name: 'New' } });
    expect(b.profile?.name).toBe('New');
  });

  it('loadUsers.fulfilled stores page', () => {
    const s = reducer(undefined, {
      type: loadUsersThunk.fulfilled.type,
      payload: { items: [u('1'), u('2')], total: 5, page: 1, pageSize: 20 },
    });
    expect(s.list.length).toBe(2);
    expect(s.total).toBe(5);
  });

  it('admin update patches list entry', () => {
    const a = reducer(undefined, {
      type: loadUsersThunk.fulfilled.type,
      payload: { items: [u('1'), u('2')], total: 2, page: 1, pageSize: 20 },
    });
    const b = reducer(a, { type: adminUpdateUserThunk.fulfilled.type, payload: u('1', 'admin') });
    expect(b.list[0].role).toBe('admin');
  });

  it('admin delete removes entry + decrements total', () => {
    const a = reducer(undefined, {
      type: loadUsersThunk.fulfilled.type,
      payload: { items: [u('1'), u('2')], total: 2, page: 1, pageSize: 20 },
    });
    const b = reducer(a, { type: adminDeleteUserThunk.fulfilled.type, payload: { deleted: '1' } });
    expect(b.list.length).toBe(1);
    expect(b.total).toBe(1);
  });

  it('reset', () => {
    const a = reducer(undefined, { type: loadProfileThunk.fulfilled.type, payload: u('1') });
    expect(reducer(a, reset()).profile).toBeNull();
  });
});
"""

_USERS_FILES["apps/web/src/components/ProfileForm.tsx"] = """import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { loadProfileThunk, updateProfileThunk } from '../features/users/Thunks';
import { selectProfile, selectProfileStatus } from '../features/users/Selectors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export function ProfileForm() {
  const dispatch = useAppDispatch();
  const profile = useAppSelector(selectProfile);
  const status = useAppSelector(selectProfileStatus);
  const [name, setName] = useState('');

  useEffect(() => {
    if (status === 'idle') dispatch(loadProfileThunk());
  }, [status, dispatch]);

  useEffect(() => {
    if (profile) setName(profile.name);
  }, [profile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            dispatch(updateProfileThunk({ name }));
          }}
        >
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={profile?.email ?? ''} readOnly disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-name">Display name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={1}
              maxLength={80}
            />
          </div>
          <Button type="submit" disabled={status === 'loading'}>Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}
"""

_USERS_FILES["apps/web/src/components/UsersList.tsx"] = """import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import {
  adminDeleteUserThunk,
  adminUpdateUserThunk,
  loadUsersThunk,
} from '../features/users/Thunks';
import {
  selectIsAdmin,
  selectUsersList,
  selectUsersStatus,
  selectUsersTotal,
} from '../features/users/Selectors';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export function UsersList() {
  const dispatch = useAppDispatch();
  const isAdmin = useAppSelector(selectIsAdmin);
  const list = useAppSelector(selectUsersList);
  const total = useAppSelector(selectUsersTotal);
  const status = useAppSelector(selectUsersStatus);

  useEffect(() => {
    if (isAdmin && status === 'idle') dispatch(loadUsersThunk());
  }, [isAdmin, status, dispatch]);

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users ({total})</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Email</th>
              <th>Name</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.email}</td>
                <td>{u.name || '—'}</td>
                <td>{u.role}</td>
                <td className="text-right space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      dispatch(
                        adminUpdateUserThunk({
                          id: u.id,
                          patch: { role: u.role === 'admin' ? 'user' : 'admin' },
                        }),
                      )
                    }
                  >
                    Toggle role
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => dispatch(adminDeleteUserThunk({ id: u.id }))}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
"""

FEATURES["users"] = {
    "files": _USERS_FILES,
    "prisma_models": "",  # User model already declared by auth (with name+role fields)
    "server_imports": "import { UsersModule } from './users/module';",
    "server_modules": "UsersModule",
    "web_reducer_imports": "import usersReducer from '../features/users/Slice';",
    "web_reducers": "users: usersReducer",
}


# ─── settings feature ────────────────────────────────────────────────────────

_SETTINGS_FILES: dict[str, str] = {}

_SETTINGS_FILES["apps/server/src/settings/dto.ts"] = """import { z } from 'zod';

export const UpdateSettingsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    locale: z.string().min(2).max(10).optional(),
  })
  .strict();

export type UpdateSettingsDto = z.infer<typeof UpdateSettingsSchema>;
"""

_SETTINGS_FILES["apps/server/src/settings/logic.ts"] = """// PURE.
export type Theme = 'light' | 'dark' | 'system';

export const DEFAULT_THEME: Theme = 'system';
export const DEFAULT_LOCALE = 'en';

export function normalizeLocale(raw: string): string {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return DEFAULT_LOCALE;
  return v.replace(/_/g, '-');
}

export function isSupportedTheme(t: string): t is Theme {
  return t === 'light' || t === 'dark' || t === 'system';
}
"""

_SETTINGS_FILES["apps/server/src/settings/logic.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { normalizeLocale, isSupportedTheme, DEFAULT_LOCALE } from './logic';

describe('settings logic', () => {
  it('normalizeLocale lowercases and converts underscore', () => {
    expect(normalizeLocale('FR_fr')).toBe('fr-fr');
    expect(normalizeLocale('  EN  ')).toBe('en');
  });
  it('normalizeLocale empty falls back to default', () => {
    expect(normalizeLocale('')).toBe(DEFAULT_LOCALE);
  });
  it('isSupportedTheme', () => {
    expect(isSupportedTheme('dark')).toBe(true);
    expect(isSupportedTheme('neon')).toBe(false);
  });
});
"""

_SETTINGS_FILES["apps/server/src/settings/repository.ts"] = """import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

export type SettingsRow = {
  userId: string;
  theme: string;
  locale: string;
  updatedAt: Date;
};

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUser(userId: string): Promise<SettingsRow | null> {
    return this.prisma.userSettings.findUnique({ where: { userId } }) as any;
  }

  upsert(userId: string, theme: string, locale: string): Promise<SettingsRow> {
    return this.prisma.userSettings.upsert({
      where: { userId },
      update: { theme, locale },
      create: { userId, theme, locale },
    }) as any;
  }
}
"""

_SETTINGS_FILES["apps/server/src/settings/service.ts"] = """import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './repository';
import { DEFAULT_LOCALE, DEFAULT_THEME, isSupportedTheme, normalizeLocale } from './logic';
import type { UpdateSettingsDto } from './dto';

export type SettingsDto = { theme: string; locale: string };

@Injectable()
export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  async get(userId: string): Promise<SettingsDto> {
    const row = await this.repo.findByUser(userId);
    if (!row) return { theme: DEFAULT_THEME, locale: DEFAULT_LOCALE };
    return { theme: row.theme, locale: row.locale };
  }

  async update(userId: string, patch: UpdateSettingsDto): Promise<SettingsDto> {
    const cur = await this.get(userId);
    const theme = patch.theme && isSupportedTheme(patch.theme) ? patch.theme : cur.theme;
    const locale = patch.locale ? normalizeLocale(patch.locale) : cur.locale;
    const row = await this.repo.upsert(userId, theme, locale);
    return { theme: row.theme, locale: row.locale };
  }
}
"""

_SETTINGS_FILES["apps/server/src/settings/controller.ts"] = """import { Body, Controller, Get, Patch, Req, UseGuards, UsePipes } from '@nestjs/common';
import { JwtGuard } from '../auth/guard';
import { ZodValidationPipe } from '../common/zod.pipe';
import { SettingsService } from './service';
import { UpdateSettingsDto, UpdateSettingsSchema } from './dto';

@Controller('settings')
@UseGuards(JwtGuard)
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  get(@Req() req: any) {
    return this.svc.get(req.userId);
  }

  @Patch()
  @UsePipes(new ZodValidationPipe(UpdateSettingsSchema))
  update(@Req() req: any, @Body() body: UpdateSettingsDto) {
    return this.svc.update(req.userId, body);
  }
}
"""

_SETTINGS_FILES["apps/server/src/settings/controller.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { SettingsController } from './controller';
import { SettingsService } from './service';
import { SettingsRepository } from './repository';

class FakeRepo {
  rows = new Map<string, { userId: string; theme: string; locale: string; updatedAt: Date }>();
  findByUser(uid: string) { return Promise.resolve(this.rows.get(uid) ?? null); }
  upsert(uid: string, theme: string, locale: string) {
    const row = { userId: uid, theme, locale, updatedAt: new Date() };
    this.rows.set(uid, row);
    return Promise.resolve(row);
  }
}

function build() {
  const repo = new FakeRepo() as unknown as SettingsRepository;
  const svc = new SettingsService(repo);
  return new SettingsController(svc);
}

describe('SettingsController', () => {
  it('returns defaults for new user', async () => {
    const ctrl = build();
    const res = await ctrl.get({ userId: 'u1' } as any);
    expect(res.theme).toBe('system');
    expect(res.locale).toBe('en');
  });

  it('persists and returns updates', async () => {
    const ctrl = build();
    await ctrl.update({ userId: 'u1' } as any, { theme: 'dark', locale: 'FR' } as any);
    const out = await ctrl.get({ userId: 'u1' } as any);
    expect(out).toEqual({ theme: 'dark', locale: 'fr' });
  });

  it('partial update keeps prior values', async () => {
    const ctrl = build();
    await ctrl.update({ userId: 'u1' } as any, { theme: 'dark', locale: 'fr' } as any);
    await ctrl.update({ userId: 'u1' } as any, { locale: 'de' } as any);
    const out = await ctrl.get({ userId: 'u1' } as any);
    expect(out).toEqual({ theme: 'dark', locale: 'de' });
  });
});
"""

_SETTINGS_FILES["apps/server/src/settings/module.ts"] = """import { Module } from '@nestjs/common';
import { SettingsController } from './controller';
import { SettingsService } from './service';
import { SettingsRepository } from './repository';
import { PrismaService } from '../db/prisma.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository, PrismaService],
})
export class SettingsModule {}
"""

_SETTINGS_FILES["apps/web/src/features/settings/Api.ts"] = """export type Settings = { theme: 'light' | 'dark' | 'system'; locale: string };

function authHeader(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function jsonOrThrow(res: Response): Promise<any> {
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

export async function fetchSettings(token: string): Promise<Settings> {
  const res = await fetch('/api/settings', { headers: { ...authHeader(token) } });
  return jsonOrThrow(res);
}

export async function patchSettings(token: string, patch: Partial<Settings>): Promise<Settings> {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow(res);
}
"""

_SETTINGS_FILES["apps/web/src/features/settings/Slice.ts"] = """import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { loadSettings, saveSettings } from './Thunks';
import type { Settings } from './Api';

const LOCAL_KEY = 'app.settings';

function readCache(): Settings | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.theme === 'string' && typeof v.locale === 'string') return v as Settings;
  } catch { /* noop */ }
  return null;
}

function writeCache(s: Settings) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

const cached = readCache();

export type SettingsState = {
  theme: 'light' | 'dark' | 'system';
  locale: string;
  status: 'idle' | 'loading' | 'saving' | 'error';
  error: string | null;
};

const initialState: SettingsState = {
  theme: cached?.theme ?? 'system',
  locale: cached?.locale ?? 'en',
  status: 'idle',
  error: null,
};

const slice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    themeChangedLocally(state, a: PayloadAction<'light' | 'dark' | 'system'>) {
      state.theme = a.payload;
      writeCache({ theme: state.theme, locale: state.locale });
    },
    localeChangedLocally(state, a: PayloadAction<string>) {
      state.locale = a.payload;
      writeCache({ theme: state.theme, locale: state.locale });
    },
  },
  extraReducers: (b) => {
    b.addCase(loadSettings.pending, (s) => { s.status = 'loading'; s.error = null; });
    b.addCase(loadSettings.fulfilled, (s, a) => {
      s.status = 'idle';
      s.theme = a.payload.theme;
      s.locale = a.payload.locale;
      writeCache(a.payload);
    });
    b.addCase(loadSettings.rejected, (s, a) => {
      s.status = 'error';
      s.error = a.error.message ?? 'load failed';
    });
    b.addCase(saveSettings.pending, (s) => { s.status = 'saving'; s.error = null; });
    b.addCase(saveSettings.fulfilled, (s, a) => {
      s.status = 'idle';
      s.theme = a.payload.theme;
      s.locale = a.payload.locale;
      writeCache(a.payload);
    });
    b.addCase(saveSettings.rejected, (s, a) => {
      s.status = 'error';
      s.error = a.error.message ?? 'save failed';
    });
  },
});

export const { themeChangedLocally, localeChangedLocally } = slice.actions;
export default slice.reducer;
"""

_SETTINGS_FILES["apps/web/src/features/settings/Thunks.ts"] = """import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchSettings, patchSettings, type Settings } from './Api';
import type { RootState } from '../../app/store';

function tokenOrThrow(state: RootState): string {
  const t = state.auth?.token;
  if (!t) throw new Error('not authenticated');
  return t;
}

export const loadSettings = createAsyncThunk<Settings, void, { state: RootState }>(
  'settings/load',
  async (_void, { getState }) => fetchSettings(tokenOrThrow(getState() as RootState)),
);

export const saveSettings = createAsyncThunk<Settings, Partial<Settings>, { state: RootState }>(
  'settings/save',
  async (patch, { getState }) => patchSettings(tokenOrThrow(getState() as RootState), patch),
);
"""

_SETTINGS_FILES["apps/web/src/features/settings/Selectors.ts"] = """import type { RootState } from '../../app/store';

export const selectTheme = (s: RootState) => s.settings.theme;
export const selectLocale = (s: RootState) => s.settings.locale;
export const selectSettingsStatus = (s: RootState) => s.settings.status;
"""

_SETTINGS_FILES["apps/web/src/features/settings/Slice.test.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import reducer, { themeChangedLocally, localeChangedLocally } from './Slice';
import { loadSettings, saveSettings } from './Thunks';

beforeEach(() => { try { localStorage.clear(); } catch { /* noop */ } });

describe('settings slice', () => {
  it('default initial', () => {
    const s = reducer(undefined, { type: '@@init' });
    expect(s.theme).toBe('system');
    expect(s.locale).toBe('en');
  });

  it('themeChangedLocally', () => {
    const s = reducer(undefined, themeChangedLocally('dark'));
    expect(s.theme).toBe('dark');
  });

  it('localeChangedLocally', () => {
    const s = reducer(undefined, localeChangedLocally('fr'));
    expect(s.locale).toBe('fr');
  });

  it('loadSettings.pending → loading', () => {
    const s = reducer(undefined, { type: loadSettings.pending.type });
    expect(s.status).toBe('loading');
  });

  it('loadSettings.fulfilled applies payload', () => {
    const s = reducer(undefined, {
      type: loadSettings.fulfilled.type,
      payload: { theme: 'dark', locale: 'fr' },
    });
    expect(s.theme).toBe('dark');
    expect(s.locale).toBe('fr');
  });

  it('saveSettings.pending → saving', () => {
    const s = reducer(undefined, { type: saveSettings.pending.type });
    expect(s.status).toBe('saving');
  });

  it('saveSettings.rejected captures error', () => {
    const s = reducer(undefined, {
      type: saveSettings.rejected.type,
      error: { message: 'boom' },
    });
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });
});
"""

_SETTINGS_FILES["apps/web/src/components/ThemeToggle.tsx"] = """import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { themeChangedLocally } from '../features/settings/Slice';
import { saveSettings } from '../features/settings/Thunks';
import { selectTheme } from '../features/settings/Selectors';
import { Button } from './ui/button';

export function ThemeToggle() {
  const theme = useAppSelector(selectTheme);
  const token = useAppSelector((s) => s.auth?.token ?? null);
  const dispatch = useAppDispatch();

  useEffect(() => {
    const root = document.documentElement;
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', dark);
  }, [theme]);

  function set(t: 'light' | 'dark' | 'system') {
    dispatch(themeChangedLocally(t));
    if (token) dispatch(saveSettings({ theme: t }));
  }

  return (
    <div className="inline-flex gap-1">
      {(['light', 'dark', 'system'] as const).map((t) => (
        <Button key={t} size="sm" variant={theme === t ? 'default' : 'outline'} onClick={() => set(t)}>
          {t}
        </Button>
      ))}
    </div>
  );
}
"""

_SETTINGS_FILES["apps/web/src/components/SettingsForm.tsx"] = """import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { loadSettings, saveSettings } from '../features/settings/Thunks';
import { selectLocale, selectSettingsStatus, selectTheme } from '../features/settings/Selectors';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ThemeToggle } from './ThemeToggle';

export function SettingsForm() {
  const theme = useAppSelector(selectTheme);
  const locale = useAppSelector(selectLocale);
  const status = useAppSelector(selectSettingsStatus);
  const token = useAppSelector((s) => s.auth?.token ?? null);
  const dispatch = useAppDispatch();
  const [draftLocale, setDraftLocale] = useState(locale);

  useEffect(() => {
    if (token) dispatch(loadSettings());
  }, [dispatch, token]);

  useEffect(() => { setDraftLocale(locale); }, [locale]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    dispatch(saveSettings({ locale: draftLocale, theme }));
  }

  return (
    <Card>
      <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>Theme</Label>
          <ThemeToggle />
        </div>
        <form onSubmit={submit} className="space-y-2">
          <Label htmlFor="locale">Locale</Label>
          <Input id="locale" value={draftLocale} onChange={(e) => setDraftLocale(e.target.value)} />
          <Button type="submit" disabled={status === 'saving'}>
            {status === 'saving' ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
"""

FEATURES["settings"] = {
    "files": _SETTINGS_FILES,
    "prisma_models": """model UserSettings {
  userId    String   @id
  theme     String   @default("system")
  locale    String   @default("en")
  updatedAt DateTime @updatedAt
}
""",
    "server_imports": "import { SettingsModule } from './settings/module';",
    "server_modules": "SettingsModule",
    "web_reducer_imports": "import settingsReducer from '../features/settings/Slice';",
    "web_reducers": "settings: settingsReducer",
}


# ─── uploads feature ─────────────────────────────────────────────────────────

_UPLOADS_FILES: dict[str, str] = {}

_UPLOADS_FILES["apps/server/src/uploads/dto.ts"] = """import { z } from 'zod';

export const CreateUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  dataBase64: z.string().min(1),
});
export type CreateUploadDto = z.infer<typeof CreateUploadSchema>;
"""

_UPLOADS_FILES["apps/server/src/uploads/logic.ts"] = """// PURE.
const ILLEGAL = /[\\\\/\\x00-\\x1f]/g;

export const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/markdown',
  'application/json', 'application/zip',
]);

export const MAX_BYTES = 10 * 1024 * 1024;

export function sanitizeFilename(raw: string): string {
  const cleaned = raw.replace(ILLEGAL, '_').trim();
  return cleaned.slice(0, 200) || 'upload';
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime.toLowerCase());
}

export function decodeAndSize(b64: string): { bytes: Buffer; size: number } {
  const bytes = Buffer.from(b64, 'base64');
  return { bytes, size: bytes.length };
}
"""

_UPLOADS_FILES["apps/server/src/uploads/logic.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { sanitizeFilename, isAllowedMime, decodeAndSize, MAX_BYTES } from './logic';

describe('uploads logic', () => {
  it('sanitizeFilename strips slashes and control chars', () => {
    expect(sanitizeFilename('../etc/passwd')).toBe('.._etc_passwd');
    expect(sanitizeFilename('file\\x00name')).toBe('file_name');
  });
  it('sanitizeFilename empty falls back', () => {
    expect(sanitizeFilename('')).toBe('upload');
  });
  it('isAllowedMime', () => {
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('application/x-msdownload')).toBe(false);
  });
  it('decodeAndSize roundtrip', () => {
    const b64 = Buffer.from('hello').toString('base64');
    const { bytes, size } = decodeAndSize(b64);
    expect(bytes.toString()).toBe('hello');
    expect(size).toBe(5);
  });
  it('MAX_BYTES is 10 MiB', () => {
    expect(MAX_BYTES).toBe(10485760);
  });
});
"""

_UPLOADS_FILES["apps/server/src/uploads/storage.ts"] = """import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface FileStorage {
  put(key: string, bytes: Buffer): Promise<string>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}
  private path(key: string) { return join(this.root, key); }
  async put(key: string, bytes: Buffer): Promise<string> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.path(key), bytes);
    return this.path(key);
  }
  read(key: string): Promise<Buffer> { return readFile(this.path(key)); }
  remove(key: string): Promise<void> { return unlink(this.path(key)); }
}
"""

_UPLOADS_FILES["apps/server/src/uploads/repository.ts"] = """import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

export type FileRow = {
  id: string;
  userId: string;
  filename: string;
  mime: string;
  size: number;
  path: string;
  createdAt: Date;
};

@Injectable()
export class UploadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(row: Omit<FileRow, 'createdAt'>): Promise<FileRow> {
    return this.prisma.fileBlob.create({ data: row }) as any;
  }
  listByUser(userId: string): Promise<FileRow[]> {
    return this.prisma.fileBlob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }) as any;
  }
  findById(id: string): Promise<FileRow | null> {
    return this.prisma.fileBlob.findUnique({ where: { id } }) as any;
  }
  delete(id: string): Promise<unknown> {
    return this.prisma.fileBlob.delete({ where: { id } });
  }
}
"""

_UPLOADS_FILES["apps/server/src/uploads/service.ts"] = """import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UploadsRepository, type FileRow } from './repository';
import { LocalDiskStorage, type FileStorage } from './storage';
import { MAX_BYTES, decodeAndSize, isAllowedMime, sanitizeFilename } from './logic';
import type { CreateUploadDto } from './dto';

export type UploadDto = {
  id: string; filename: string; mime: string; size: number; createdAt: string;
};

function toDto(r: FileRow): UploadDto {
  return {
    id: r.id, filename: r.filename, mime: r.mime, size: r.size,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class UploadsService {
  private storage: FileStorage;
  constructor(private readonly repo: UploadsRepository) {
    this.storage = new LocalDiskStorage(process.env.UPLOADS_DIR || './uploads-data');
  }

  async create(userId: string, dto: CreateUploadDto): Promise<UploadDto> {
    if (!isAllowedMime(dto.mime)) throw new BadRequestException('mime not allowed');
    const { bytes, size } = decodeAndSize(dto.dataBase64);
    if (size === 0) throw new BadRequestException('empty file');
    if (size > MAX_BYTES) throw new BadRequestException('file too large');
    const id = randomUUID();
    const path = await this.storage.put(id, bytes);
    const row = await this.repo.create({
      id, userId, filename: sanitizeFilename(dto.filename),
      mime: dto.mime.toLowerCase(), size, path,
    });
    return toDto(row);
  }

  async list(userId: string): Promise<UploadDto[]> {
    const rows = await this.repo.listByUser(userId);
    return rows.map(toDto);
  }

  async download(userId: string, id: string): Promise<{ row: FileRow; bytes: Buffer }> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('file not found');
    if (row.userId !== userId) throw new ForbiddenException('not your file');
    const bytes = await this.storage.read(id);
    return { row, bytes };
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('file not found');
    if (row.userId !== userId) throw new ForbiddenException('not your file');
    await this.storage.remove(id).catch(() => undefined);
    await this.repo.delete(id);
    return { ok: true };
  }
}
"""

_UPLOADS_FILES["apps/server/src/uploads/controller.ts"] = """import { Body, Controller, Delete, Get, Param, Post, Req, Res, UseGuards, UsePipes } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/guard';
import { ZodValidationPipe } from '../common/zod.pipe';
import { UploadsService } from './service';
import { CreateUploadDto, CreateUploadSchema } from './dto';

@Controller('uploads')
@UseGuards(JwtGuard)
export class UploadsController {
  constructor(private readonly svc: UploadsService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateUploadSchema))
  create(@Req() req: any, @Body() body: CreateUploadDto) {
    return this.svc.create(req.userId, body);
  }

  @Get()
  list(@Req() req: any) {
    return this.svc.list(req.userId);
  }

  @Get(':id')
  async download(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const { row, bytes } = await this.svc.download(req.userId, id);
    res.setHeader('content-type', row.mime);
    res.setHeader('content-disposition', `attachment; filename="${row.filename}"`);
    res.send(bytes);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.svc.remove(req.userId, id);
  }
}
"""

_UPLOADS_FILES["apps/server/src/uploads/controller.spec.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import { UploadsController } from './controller';
import { UploadsService } from './service';
import { UploadsRepository, type FileRow } from './repository';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';

class FakeRepo {
  rows: FileRow[] = [];
  create(r: Omit<FileRow, 'createdAt'>) {
    const row = { ...r, createdAt: new Date() };
    this.rows.push(row);
    return Promise.resolve(row);
  }
  listByUser(uid: string) {
    return Promise.resolve(this.rows.filter((r) => r.userId === uid));
  }
  findById(id: string) {
    return Promise.resolve(this.rows.find((r) => r.id === id) ?? null);
  }
  delete(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
    return Promise.resolve({});
  }
}

let tmpDir = '';
beforeEach(() => {
  tmpDir = `/tmp/up-${Math.random().toString(36).slice(2)}`;
  process.env.UPLOADS_DIR = tmpDir;
});

function build() {
  const repo = new FakeRepo() as unknown as UploadsRepository;
  const svc = new UploadsService(repo);
  return { ctrl: new UploadsController(svc), repo: repo as any as FakeRepo };
}

const sample = {
  filename: 'hello.txt',
  mime: 'text/plain',
  dataBase64: Buffer.from('hi').toString('base64'),
};

describe('UploadsController', () => {
  it('create stores and returns DTO', async () => {
    const { ctrl } = build();
    const out = await ctrl.create({ userId: 'u1' } as any, sample as any);
    expect(out.filename).toBe('hello.txt');
    expect(out.size).toBe(2);
    expect(out.id).toBeDefined();
  });

  it('rejects disallowed mime', async () => {
    const { ctrl } = build();
    await expect(ctrl.create({ userId: 'u1' } as any, { ...sample, mime: 'application/x-msdownload' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('list returns only own files', async () => {
    const { ctrl } = build();
    await ctrl.create({ userId: 'u1' } as any, sample as any);
    await ctrl.create({ userId: 'u2' } as any, sample as any);
    const out = await ctrl.list({ userId: 'u1' } as any);
    expect(out).toHaveLength(1);
  });

  it('download forbidden across users', async () => {
    const { ctrl } = build();
    const created = await ctrl.create({ userId: 'u1' } as any, sample as any);
    const res: any = { setHeader: () => {}, send: () => {} };
    await expect(ctrl.download({ userId: 'u2' } as any, created.id, res))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('download missing → 404', async () => {
    const { ctrl } = build();
    const res: any = { setHeader: () => {}, send: () => {} };
    await expect(ctrl.download({ userId: 'u1' } as any, 'nope', res))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove own file', async () => {
    const { ctrl, repo } = build();
    const created = await ctrl.create({ userId: 'u1' } as any, sample as any);
    await ctrl.remove({ userId: 'u1' } as any, created.id);
    expect(repo.rows).toHaveLength(0);
  });
});
"""

_UPLOADS_FILES["apps/server/src/uploads/module.ts"] = """import { Module } from '@nestjs/common';
import { UploadsController } from './controller';
import { UploadsService } from './service';
import { UploadsRepository } from './repository';
import { PrismaService } from '../db/prisma.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, UploadsRepository, PrismaService],
})
export class UploadsModule {}
"""

_UPLOADS_FILES["apps/web/src/features/uploads/Api.ts"] = """export type Upload = {
  id: string; filename: string; mime: string; size: number; createdAt: string;
};

function authHeader(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function jsonOrThrow(res: Response): Promise<any> {
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

export async function listUploads(token: string): Promise<Upload[]> {
  return jsonOrThrow(await fetch('/api/uploads', { headers: { ...authHeader(token) } }));
}

export async function uploadFile(token: string, payload: { filename: string; mime: string; dataBase64: string }): Promise<Upload> {
  return jsonOrThrow(
    await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(token) },
      body: JSON.stringify(payload),
    }),
  );
}

export async function deleteUpload(token: string, id: string): Promise<void> {
  const res = await fetch(`/api/uploads/${id}`, { method: 'DELETE', headers: { ...authHeader(token) } });
  if (!res.ok) throw new Error(`http ${res.status}`);
}

export function downloadUrl(id: string): string { return `/api/uploads/${id}`; }
"""

_UPLOADS_FILES["apps/web/src/features/uploads/Slice.ts"] = """import { createSlice } from '@reduxjs/toolkit';
import { listUploadsThunk, uploadFileThunk, deleteUploadThunk } from './Thunks';
import type { Upload } from './Api';

export type UploadsState = {
  byId: Record<string, Upload>;
  order: string[];
  status: 'idle' | 'loading' | 'uploading' | 'error';
  error: string | null;
};

const initialState: UploadsState = { byId: {}, order: [], status: 'idle', error: null };

const slice = createSlice({
  name: 'uploads',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(listUploadsThunk.pending, (s) => { s.status = 'loading'; s.error = null; });
    b.addCase(listUploadsThunk.fulfilled, (s, a) => {
      s.status = 'idle';
      s.byId = {};
      s.order = [];
      for (const u of a.payload) { s.byId[u.id] = u; s.order.push(u.id); }
    });
    b.addCase(listUploadsThunk.rejected, (s, a) => {
      s.status = 'error'; s.error = a.error.message ?? 'load failed';
    });
    b.addCase(uploadFileThunk.pending, (s) => { s.status = 'uploading'; s.error = null; });
    b.addCase(uploadFileThunk.fulfilled, (s, a) => {
      s.status = 'idle';
      s.byId[a.payload.id] = a.payload;
      s.order.unshift(a.payload.id);
    });
    b.addCase(uploadFileThunk.rejected, (s, a) => {
      s.status = 'error'; s.error = a.error.message ?? 'upload failed';
    });
    b.addCase(deleteUploadThunk.fulfilled, (s, a) => {
      delete s.byId[a.payload];
      s.order = s.order.filter((id) => id !== a.payload);
    });
  },
});

export default slice.reducer;
"""

_UPLOADS_FILES["apps/web/src/features/uploads/Thunks.ts"] = """import { createAsyncThunk } from '@reduxjs/toolkit';
import { deleteUpload, listUploads, uploadFile, type Upload } from './Api';
import type { RootState } from '../../app/store';

function tokenOrThrow(state: RootState): string {
  const t = state.auth?.token;
  if (!t) throw new Error('not authenticated');
  return t;
}

export const listUploadsThunk = createAsyncThunk<Upload[], void, { state: RootState }>(
  'uploads/list',
  async (_v, { getState }) => listUploads(tokenOrThrow(getState() as RootState)),
);

export const uploadFileThunk = createAsyncThunk<
  Upload, { filename: string; mime: string; dataBase64: string }, { state: RootState }
>(
  'uploads/upload',
  async (payload, { getState }) => uploadFile(tokenOrThrow(getState() as RootState), payload),
);

export const deleteUploadThunk = createAsyncThunk<string, string, { state: RootState }>(
  'uploads/delete',
  async (id, { getState }) => {
    await deleteUpload(tokenOrThrow(getState() as RootState), id);
    return id;
  },
);
"""

_UPLOADS_FILES["apps/web/src/features/uploads/Selectors.ts"] = """import type { RootState } from '../../app/store';

export const selectUploadList = (s: RootState) => s.uploads.order.map((id) => s.uploads.byId[id]);
export const selectUploadStatus = (s: RootState) => s.uploads.status;
export const selectUploadError = (s: RootState) => s.uploads.error;
"""

_UPLOADS_FILES["apps/web/src/features/uploads/Slice.test.ts"] = """import { describe, it, expect } from 'vitest';
import reducer from './Slice';
import { listUploadsThunk, uploadFileThunk, deleteUploadThunk } from './Thunks';

const u1 = { id: '1', filename: 'a.txt', mime: 'text/plain', size: 2, createdAt: 'now' };
const u2 = { id: '2', filename: 'b.txt', mime: 'text/plain', size: 3, createdAt: 'now' };

describe('uploads slice', () => {
  it('initial empty', () => {
    const s = reducer(undefined, { type: '@@init' });
    expect(s.order).toEqual([]);
  });

  it('list.fulfilled hydrates', () => {
    const s = reducer(undefined, { type: listUploadsThunk.fulfilled.type, payload: [u1, u2] });
    expect(s.order).toEqual(['1', '2']);
    expect(s.byId['1'].filename).toBe('a.txt');
  });

  it('upload.pending switches status', () => {
    const s = reducer(undefined, { type: uploadFileThunk.pending.type });
    expect(s.status).toBe('uploading');
  });

  it('upload.fulfilled prepends', () => {
    let s = reducer(undefined, { type: listUploadsThunk.fulfilled.type, payload: [u1] });
    s = reducer(s, { type: uploadFileThunk.fulfilled.type, payload: u2 });
    expect(s.order).toEqual(['2', '1']);
  });

  it('delete.fulfilled removes', () => {
    let s = reducer(undefined, { type: listUploadsThunk.fulfilled.type, payload: [u1, u2] });
    s = reducer(s, { type: deleteUploadThunk.fulfilled.type, payload: '1' });
    expect(s.order).toEqual(['2']);
    expect(s.byId['1']).toBeUndefined();
  });

  it('upload.rejected captures error', () => {
    const s = reducer(undefined, { type: uploadFileThunk.rejected.type, error: { message: 'boom' } });
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });
});
"""

_UPLOADS_FILES["apps/web/src/components/UploadForm.tsx"] = """import { useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { listUploadsThunk, uploadFileThunk, deleteUploadThunk } from '../features/uploads/Thunks';
import { selectUploadList, selectUploadStatus, selectUploadError } from '../features/uploads/Selectors';
import { downloadUrl } from '../features/uploads/Api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const v = String(r.result || '');
      const i = v.indexOf(',');
      resolve(i >= 0 ? v.slice(i + 1) : v);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function UploadForm() {
  const list = useAppSelector(selectUploadList);
  const status = useAppSelector(selectUploadStatus);
  const error = useAppSelector(selectUploadError);
  const token = useAppSelector((s) => s.auth?.token ?? null);
  const dispatch = useAppDispatch();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (token) dispatch(listUploadsThunk()); }, [dispatch, token]);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataBase64 = await readAsBase64(file);
      await dispatch(uploadFileThunk({ filename: file.name, mime: file.type || 'application/octet-stream', dataBase64 })).unwrap();
    } catch { /* error captured in slice */ }
    finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Files</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <input ref={ref} type="file" onChange={pick} disabled={busy || status === 'uploading'} />
          {status === 'uploading' || busy ? <span className="text-sm text-muted-foreground">Uploading…</span> : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <ul className="space-y-1 text-sm">
          {list.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 border-b py-1">
              <a href={downloadUrl(u.id)} className="underline">{u.filename}</a>
              <span className="text-muted-foreground">{u.size} B</span>
              <Button size="sm" variant="destructive" onClick={() => dispatch(deleteUploadThunk(u.id))}>Delete</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
"""

FEATURES["uploads"] = {
    "files": _UPLOADS_FILES,
    "prisma_models": """model FileBlob {
  id        String   @id
  userId    String
  filename  String
  mime      String
  size      Int
  path      String
  createdAt DateTime @default(now())
}
""",
    "server_imports": "import { UploadsModule } from './uploads/module';",
    "server_modules": "UploadsModule",
    "web_reducer_imports": "import uploadsReducer from '../features/uploads/Slice';",
    "web_reducers": "uploads: uploadsReducer",
}


# ─── dashboard feature ───────────────────────────────────────────────────────

_DASHBOARD_FILES: dict[str, str] = {}

_DASHBOARD_FILES["apps/server/src/dashboard/logic.ts"] = """// PURE.
export type Stats = { users: number; files: number; storageBytes: number };
export const ZERO: Stats = { users: 0, files: 0, storageBytes: 0 };

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
"""

_DASHBOARD_FILES["apps/server/src/dashboard/logic.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { fmtBytes } from './logic';

describe('dashboard logic', () => {
  it('formats bytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1024)).toBe('1.0 KB');
    expect(fmtBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
"""

_DASHBOARD_FILES["apps/server/src/dashboard/repository.ts"] = """import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countUsers(): Promise<number> {
    try { return await (this.prisma as any).user.count(); } catch { return 0; }
  }
  async countFiles(userId: string): Promise<number> {
    try { return await (this.prisma as any).fileBlob.count({ where: { userId } }); } catch { return 0; }
  }
  async sumFileBytes(userId: string): Promise<number> {
    try {
      const r = await (this.prisma as any).fileBlob.aggregate({
        where: { userId }, _sum: { size: true },
      });
      return r?._sum?.size ?? 0;
    } catch { return 0; }
  }
}
"""

_DASHBOARD_FILES["apps/server/src/dashboard/service.ts"] = """import { Injectable } from '@nestjs/common';
import { DashboardRepository } from './repository';
import type { Stats } from './logic';

@Injectable()
export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}

  async stats(userId: string): Promise<Stats> {
    const [users, files, storageBytes] = await Promise.all([
      this.repo.countUsers(),
      this.repo.countFiles(userId),
      this.repo.sumFileBytes(userId),
    ]);
    return { users, files, storageBytes };
  }
}
"""

_DASHBOARD_FILES["apps/server/src/dashboard/controller.ts"] = """import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guard';
import { DashboardService } from './service';

@Controller('dashboard')
@UseGuards(JwtGuard)
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('stats')
  stats(@Req() req: any) {
    return this.svc.stats(req.userId);
  }
}
"""

_DASHBOARD_FILES["apps/server/src/dashboard/controller.spec.ts"] = """import { describe, it, expect } from 'vitest';
import { DashboardController } from './controller';
import { DashboardService } from './service';
import { DashboardRepository } from './repository';

class FakeRepo {
  countUsers() { return Promise.resolve(7); }
  countFiles(_uid: string) { return Promise.resolve(3); }
  sumFileBytes(_uid: string) { return Promise.resolve(2048); }
}

describe('DashboardController', () => {
  it('returns aggregated stats', async () => {
    const ctrl = new DashboardController(new DashboardService(new FakeRepo() as unknown as DashboardRepository));
    const out = await ctrl.stats({ userId: 'u1' } as any);
    expect(out).toEqual({ users: 7, files: 3, storageBytes: 2048 });
  });
});
"""

_DASHBOARD_FILES["apps/server/src/dashboard/module.ts"] = """import { Module } from '@nestjs/common';
import { DashboardController } from './controller';
import { DashboardService } from './service';
import { DashboardRepository } from './repository';
import { PrismaService } from '../db/prisma.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository, PrismaService],
})
export class DashboardModule {}
"""

_DASHBOARD_FILES["apps/web/src/features/dashboard/Api.ts"] = """export type Stats = { users: number; files: number; storageBytes: number };

function authHeader(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchStats(token: string): Promise<Stats> {
  const res = await fetch('/api/dashboard/stats', { headers: { ...authHeader(token) } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}
"""

_DASHBOARD_FILES["apps/web/src/features/dashboard/Slice.ts"] = """import { createSlice } from '@reduxjs/toolkit';
import { loadStats } from './Thunks';
import type { Stats } from './Api';

export type DashboardState = {
  stats: Stats;
  status: 'idle' | 'loading' | 'error';
  error: string | null;
};

const initialState: DashboardState = {
  stats: { users: 0, files: 0, storageBytes: 0 },
  status: 'idle',
  error: null,
};

const slice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(loadStats.pending, (s) => { s.status = 'loading'; s.error = null; });
    b.addCase(loadStats.fulfilled, (s, a) => { s.status = 'idle'; s.stats = a.payload; });
    b.addCase(loadStats.rejected, (s, a) => {
      s.status = 'error'; s.error = a.error.message ?? 'load failed';
    });
  },
});

export default slice.reducer;
"""

_DASHBOARD_FILES["apps/web/src/features/dashboard/Thunks.ts"] = """import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchStats, type Stats } from './Api';
import type { RootState } from '../../app/store';

export const loadStats = createAsyncThunk<Stats, void, { state: RootState }>(
  'dashboard/load',
  async (_v, { getState }) => {
    const t = (getState() as RootState).auth?.token;
    if (!t) throw new Error('not authenticated');
    return fetchStats(t);
  },
);
"""

_DASHBOARD_FILES["apps/web/src/features/dashboard/Selectors.ts"] = """import type { RootState } from '../../app/store';

export const selectStats = (s: RootState) => s.dashboard.stats;
export const selectDashboardStatus = (s: RootState) => s.dashboard.status;
"""

_DASHBOARD_FILES["apps/web/src/features/dashboard/Slice.test.ts"] = """import { describe, it, expect } from 'vitest';
import reducer from './Slice';
import { loadStats } from './Thunks';

describe('dashboard slice', () => {
  it('initial zero stats', () => {
    const s = reducer(undefined, { type: '@@init' });
    expect(s.stats).toEqual({ users: 0, files: 0, storageBytes: 0 });
  });
  it('fulfilled hydrates', () => {
    const s = reducer(undefined, {
      type: loadStats.fulfilled.type,
      payload: { users: 5, files: 2, storageBytes: 100 },
    });
    expect(s.stats.users).toBe(5);
    expect(s.status).toBe('idle');
  });
  it('rejected captures error', () => {
    const s = reducer(undefined, { type: loadStats.rejected.type, error: { message: 'x' } });
    expect(s.status).toBe('error');
    expect(s.error).toBe('x');
  });
});
"""

_DASHBOARD_FILES["apps/web/src/components/DashboardCard.tsx"] = """import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { loadStats } from '../features/dashboard/Thunks';
import { selectStats } from '../features/dashboard/Selectors';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function DashboardCard() {
  const stats = useAppSelector(selectStats);
  const token = useAppSelector((s) => s.auth?.token ?? null);
  const dispatch = useAppDispatch();
  useEffect(() => { if (token) dispatch(loadStats()); }, [dispatch, token]);
  return (
    <Card>
      <CardHeader><CardTitle>Overview</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><div className="text-2xl font-semibold">{stats.users}</div><div className="text-muted-foreground">users</div></div>
          <div><div className="text-2xl font-semibold">{stats.files}</div><div className="text-muted-foreground">files</div></div>
          <div><div className="text-2xl font-semibold">{fmtBytes(stats.storageBytes)}</div><div className="text-muted-foreground">storage</div></div>
        </div>
      </CardContent>
    </Card>
  );
}
"""

FEATURES["dashboard"] = {
    "files": _DASHBOARD_FILES,
    "prisma_models": "",
    "server_imports": "import { DashboardModule } from './dashboard/module';",
    "server_modules": "DashboardModule",
    "web_reducer_imports": "import dashboardReducer from '../features/dashboard/Slice';",
    "web_reducers": "dashboard: dashboardReducer",
}


# ─── notifications feature (client-only toast system) ────────────────────────

_NOTIF_FILES: dict[str, str] = {}

_NOTIF_FILES["apps/web/src/features/notifications/Slice.ts"] = """import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type Toast = { id: string; kind: 'info' | 'success' | 'error'; message: string };
export type NotificationsState = { items: Toast[] };

const initialState: NotificationsState = { items: [] };

let counter = 0;
function makeId(): string { counter += 1; return `${Date.now()}-${counter}`; }

const slice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    notify: {
      reducer(state, action: PayloadAction<Toast>) {
        state.items.push(action.payload);
        if (state.items.length > 20) state.items.shift();
      },
      prepare(input: { kind?: Toast['kind']; message: string }) {
        return { payload: { id: makeId(), kind: input.kind ?? 'info', message: input.message } };
      },
    },
    dismiss(state, action: PayloadAction<string>) {
      state.items = state.items.filter((t) => t.id !== action.payload);
    },
    clearAll(state) { state.items = []; },
  },
});

export const { notify, dismiss, clearAll } = slice.actions;
export default slice.reducer;
"""

_NOTIF_FILES["apps/web/src/features/notifications/Selectors.ts"] = """import type { RootState } from '../../app/store';

export const selectToasts = (s: RootState) => s.notifications.items;
"""

_NOTIF_FILES["apps/web/src/features/notifications/Slice.test.ts"] = """import { describe, it, expect } from 'vitest';
import reducer, { notify, dismiss, clearAll } from './Slice';

describe('notifications slice', () => {
  it('starts empty', () => {
    const s = reducer(undefined, { type: '@@init' });
    expect(s.items).toEqual([]);
  });
  it('notify appends a toast', () => {
    const s = reducer(undefined, notify({ kind: 'info', message: 'hi' }));
    expect(s.items).toHaveLength(1);
    expect(s.items[0].message).toBe('hi');
  });
  it('dismiss removes by id', () => {
    let s = reducer(undefined, notify({ kind: 'info', message: 'a' }));
    s = reducer(s, notify({ kind: 'info', message: 'b' }));
    const idA = s.items[0].id;
    s = reducer(s, dismiss(idA));
    expect(s.items).toHaveLength(1);
    expect(s.items[0].message).toBe('b');
  });
  it('clearAll empties', () => {
    let s = reducer(undefined, notify({ message: 'a' }));
    s = reducer(s, notify({ message: 'b' }));
    s = reducer(s, clearAll());
    expect(s.items).toEqual([]);
  });
  it('caps at 20 toasts', () => {
    let s = reducer(undefined, { type: '@@init' });
    for (let i = 0; i < 25; i++) s = reducer(s, notify({ message: `m${i}` }));
    expect(s.items).toHaveLength(20);
    expect(s.items[0].message).toBe('m5');
  });
});
"""

_NOTIF_FILES["apps/web/src/components/Toaster.tsx"] = """import { useAppDispatch, useAppSelector } from '../app/hooks';
import { dismiss } from '../features/notifications/Slice';
import { selectToasts } from '../features/notifications/Selectors';

const KIND_CLASS: Record<string, string> = {
  info: 'border-blue-300 bg-blue-50 text-blue-900',
  success: 'border-green-300 bg-green-50 text-green-900',
  error: 'border-red-300 bg-red-50 text-red-900',
};

export function Toaster() {
  const items = useAppSelector(selectToasts);
  const dispatch = useAppDispatch();
  if (items.length === 0) return null;
  return (
    <div className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={`rounded-md border px-3 py-2 text-sm shadow-sm ${KIND_CLASS[t.kind] ?? ''}`}>
          <div className="flex items-start justify-between gap-2">
            <span>{t.message}</span>
            <button className="text-xs opacity-60 hover:opacity-100" onClick={() => dispatch(dismiss(t.id))}>×</button>
          </div>
        </div>
      ))}
    </div>
  );
}
"""

FEATURES["notifications"] = {
    "files": _NOTIF_FILES,
    "prisma_models": "",
    "server_imports": "",
    "server_modules": "",
    "web_reducer_imports": "import notificationsReducer from '../features/notifications/Slice';",
    "web_reducers": "notifications: notificationsReducer",
}


# ─── apply ───────────────────────────────────────────────────────────────────

VALID_FEATURES = ("auth", "users", "settings", "uploads", "dashboard", "notifications")
FEATURE_DEPENDENCIES = {
    "users": ("auth",),
    "settings": ("auth",),
    "uploads": ("auth",),
    "dashboard": ("auth",),
}


def _resolve_features(features: list[str] | None) -> tuple[list[str], list[str]]:
    requested = list(dict.fromkeys(features or []))
    resolved: list[str] = []
    auto_added: list[str] = []

    def add(feature: str):
        if feature in resolved:
            return
        for dep in FEATURE_DEPENDENCIES.get(feature, ()):
            if dep not in requested and dep not in auto_added:
                auto_added.append(dep)
            add(dep)
        resolved.append(feature)

    for feature in requested:
        add(feature)
    return resolved, auto_added


def apply(target: str | Path, name: str = "my-app", features: list[str] | None = None) -> dict:
    """Write the full-stack app skeleton into `target`.

    Args:
        target: destination dir.
        name: workspace package name (root package.json).
        features: optional list of features to scaffold (P2+: 'auth', 'users', ...).
                  P1 (skeleton) emits no extra features regardless.
    """
    if features:
        bad = [f for f in features if f not in VALID_FEATURES]
        if bad:
            raise ValueError(
                f"unknown feature(s) {bad}. valid: {', '.join(VALID_FEATURES)}"
            )
    resolved_features, auto_added = _resolve_features(features)

    root = Path(target).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    created: list[str] = []
    skipped: list[str] = []

    merged: dict[str, str] = dict(FILES)

    server_imports: list[str] = []
    server_modules: list[str] = []
    web_imports: list[str] = []
    web_reducers: list[str] = []
    prisma_models: list[str] = []
    feature_keys: list[str] = []

    for f in resolved_features:
        spec = FEATURES.get(f)
        if not spec:
            # Feature listed in VALID_FEATURES but not yet implemented.
            continue
        feature_keys.append(f)
        for rel, content in spec["files"].items():
            merged[rel] = content
        if spec.get("prisma_models"):
            prisma_models.append(spec["prisma_models"])
        if spec.get("server_imports"):
            server_imports.append(spec["server_imports"])
        if spec.get("server_modules"):
            server_modules.append(spec["server_modules"])
        if spec.get("web_reducer_imports"):
            web_imports.append(spec["web_reducer_imports"])
        if spec.get("web_reducers"):
            web_reducers.append(spec["web_reducers"])

    # Inject sentinels in core files.
    if "apps/server/src/app.module.ts" in merged:
        merged["apps/server/src/app.module.ts"] = (
            merged["apps/server/src/app.module.ts"]
            .replace("/* __FEATURE_MODULE_IMPORTS__ */", "\n".join(server_imports))
            .replace(", /* __FEATURE_MODULES__ */", (", " + ", ".join(server_modules)) if server_modules else "")
        )
    if "apps/web/src/app/rootReducer.ts" in merged:
        merged["apps/web/src/app/rootReducer.ts"] = (
            merged["apps/web/src/app/rootReducer.ts"]
            .replace("/* __FEATURE_REDUCER_IMPORTS__ */", "\n".join(web_imports))
            .replace("/* __FEATURE_REDUCERS__ */", ",\n  ".join(web_reducers))
        )
    if "apps/server/prisma/schema.prisma" in merged:
        merged["apps/server/prisma/schema.prisma"] = merged[
            "apps/server/prisma/schema.prisma"
        ].replace("// __FEATURE_MODELS__", "\n".join(prisma_models))

    if "apps/web/src/App.tsx" in merged:
        app_imports: list[str] = []
        app_panels: list[str] = []
        app_overlays: list[str] = []
        if "users" in feature_keys:
            app_imports.append("import { ProfileForm } from './components/ProfileForm';")
            app_panels.append("<ProfileForm />")
        if "dashboard" in feature_keys:
            app_imports.append("import { DashboardCard } from './components/DashboardCard';")
            app_panels.append("<DashboardCard />")
        if "settings" in feature_keys:
            app_imports.append("import { SettingsForm } from './components/SettingsForm';")
            app_panels.append("<SettingsForm />")
        if "uploads" in feature_keys:
            app_imports.append("import { UploadForm } from './components/UploadForm';")
            app_panels.append("<UploadForm />")
        if "notifications" in feature_keys:
            app_imports.append("import { Toaster } from './components/Toaster';")
            app_overlays.append("<Toaster />")
        merged["apps/web/src/App.tsx"] = (
            merged["apps/web/src/App.tsx"]
            .replace("/* __APP_FEATURE_IMPORTS__ */", "\n".join(app_imports))
            .replace("{/* __APP_FEATURE_PANELS__ */}", "\n        ".join(app_panels))
            .replace("{/* __APP_FEATURE_OVERLAYS__ */}", "\n      ".join(app_overlays))
        )

    for rel, content in merged.items():
        body = content.replace("__APP_NAME__", name)
        p = root / rel
        if p.exists():
            skipped.append(rel)
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
        created.append(rel)

    return {
        "root": str(root),
        "name": name,
        "features": resolved_features,
        "auto_added_features": auto_added,
        "created": created,
        "skipped": skipped,
    }


def file_count(features: list[str] | None = None) -> int:
    n = len(FILES)
    resolved_features, _ = _resolve_features(features)
    for f in resolved_features:
        spec = FEATURES.get(f)
        if spec:
            n += len(spec["files"])
    return n
