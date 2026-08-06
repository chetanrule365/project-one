# Build better-sqlite3 on Linux; run with persistent /data volume on Railway.
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
  && npx esbuild scripts/railway-start.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --packages=external \
    --outfile=build/start.js

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV NODE_OPTIONS=--max-old-space-size=384
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm rebuild better-sqlite3
COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
RUN mkdir -p /data
EXPOSE 3000
# Plain Node — no tsx (lower memory, fewer crash loops on small Railway plans)
CMD ["node", "build/start.js"]
