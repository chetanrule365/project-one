# Build better-sqlite3 on Linux; run with persistent /data volume on Railway.
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm rebuild better-sqlite3
COPY --from=build /app/build ./build
COPY --from=build /app/app ./app
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "--import", "tsx", "scripts/railway-start.ts"]
