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
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
# Runtime needs libc for native better-sqlite3; no compiler required if built above on same image family
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/app ./app
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["npm", "start"]
