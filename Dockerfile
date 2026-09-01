# ─── LLM Router Dockerfile ─────────────────────────────
# Multi-stage build producing a small standalone Next.js
# image. Uses Next.js "output: standalone" for minimal size.

# ─── Stage 1: Dependencies ─────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Copy prisma schema so the postinstall (prisma generate) can run
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --omit=dev

# ─── Stage 2: Build ────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client, build the standalone output, and
# create the SQLite database schema (seeded into the image)
ENV DATABASE_URL="file:/app/prisma/dev.db"
RUN npx prisma generate && npm run build && npx prisma db push

# ─── Stage 3: Runtime ──────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4006
ENV HOSTNAME=0.0.0.0

# Copy standalone output (includes server + minimal node_modules)
COPY --from=builder /app/.next/standalone ./
# Copy static assets
COPY --from=builder /app/.next/static ./.next/static
# Copy Prisma schema + generated client for runtime DB access
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Seed the initialized database into a staging location.
# On first boot the entrypoint copies it into the volume if empty.
COPY --from=builder /app/prisma/dev.db /app/seed/dev.db

# Entrypoint seeds the DB on first boot, then starts the server
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Persist the SQLite database outside the container
VOLUME ["/app/prisma"]

EXPOSE 4006

ENTRYPOINT ["./docker-entrypoint.sh"]
