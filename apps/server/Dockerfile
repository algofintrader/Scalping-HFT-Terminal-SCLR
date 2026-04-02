FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
RUN bun install --frozen-lockfile

# Development
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY . .
WORKDIR /app/apps/server
CMD ["bun", "--watch", "src/index.ts"]

# Production build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/apps/server
RUN bun build src/index.ts --outdir dist --target bun

# Production
FROM base AS runner
COPY --from=builder /app/apps/server/dist ./dist
ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "dist/index.js"]
