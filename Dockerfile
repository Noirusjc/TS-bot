# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (dev included — needed for tsc + prisma CLI)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# dumb-init: proper PID 1 / signal handling in containers
RUN apk add --no-cache dumb-init

# Copy package manifests and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies — including prisma CLI which is in devDependencies.
# We need the prisma binary at runtime to run "prisma migrate deploy".
# --omit=dev would remove it and break migrations.
RUN npm ci

# Generate Prisma client in this stage
RUN npx prisma generate

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist/

# Copy static frontend files
COPY public ./public/

# Copy startup script and make executable
COPY scripts/start.sh ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 && chown -R nodejs:nodejs /app
USER nodejs

# Railway injects PORT at runtime — do not hardcode
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "./scripts/start.sh"]
