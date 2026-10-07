FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.19.0 && pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS app
ENV NODE_ENV=production PORT=4173
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /var/lib/kinavapro/leads /var/lib/kinavapro/operations && chown node:node /var/lib/kinavapro/leads /var/lib/kinavapro/operations
USER node
CMD ["node", "--max-old-space-size=512", "server.js"]

FROM node:24-bookworm-slim AS browser-worker
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4180 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY worker.js ./
COPY lib/browser-audit.js lib/browser-client.js lib/safe-fetch.js lib/audit-queue.js lib/operations.js ./lib/
USER node
CMD ["node", "--max-old-space-size=192", "worker.js"]
