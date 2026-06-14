# Stage 1: build frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --include=dev
COPY frontend/ ./
RUN npm run build

# Stage 2: build backend + install all deps
FROM node:20-slim AS backend-builder
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev --legacy-peer-deps
COPY prisma ./prisma
RUN node_modules/.bin/prisma generate
COPY . .
RUN npm run build

# Stage 3: production — reuse node_modules from builder
FROM node:20-slim AS runner
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=frontend-builder /app/frontend/dist ./public
COPY prisma ./prisma
COPY scripts ./scripts
RUN chmod +x scripts/db-bootstrap.sh

EXPOSE 3000

CMD ["sh", "scripts/db-bootstrap.sh"]
