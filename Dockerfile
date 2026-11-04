# syntax=docker/dockerfile:1
# glibc, not alpine: better-sqlite3 ships prebuilt binaries for glibc and needs a
# toolchain to build against musl. Debian slim keeps `docker build` working.
FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next traces the standalone output; a missing public/ used to fail this COPY.
RUN mkdir -p public && npm run build

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MEMORIA_DB_PATH=/app/data/memoria.db

RUN groupadd --system --gid 1001 memoria \
 && useradd --system --uid 1001 --gid memoria memoria

# The database lives on a volume. Without one, every container rebuild is amnesia —
# which is exactly what the previous image did.
RUN mkdir -p /app/data && chown -R memoria:memoria /app/data
VOLUME ["/app/data"]

COPY --from=builder --chown=memoria:memoria /app/.next/standalone ./
COPY --from=builder --chown=memoria:memoria /app/.next/static ./.next/static

USER memoria
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
