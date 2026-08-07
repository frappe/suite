ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS frontend
WORKDIR /repo
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
COPY package.json yarn.lock ./
COPY frontend/package.json ./frontend/package.json
RUN yarn install --frozen-lockfile
COPY frontend ./frontend
RUN yarn workspace @suite/frontend build:recorder

FROM node:${NODE_VERSION} AS server
WORKDIR /repo/suite/meet/recorder-server
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
COPY suite/meet/recorder-server/package.json suite/meet/recorder-server/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY suite/meet/recorder-server/tsconfig.json ./
COPY suite/meet/recorder-server/src ./src
RUN yarn build && yarn install --frozen-lockfile --production --ignore-scripts --prefer-offline

FROM node:${NODE_VERSION} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ffmpeg xvfb x11-utils pulseaudio pulseaudio-utils tini ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/recorder-server
ENV NODE_ENV=production \
    PORT=3010 \
    CHROMIUM_EXECUTABLE=/usr/bin/chromium \
    RECORDER_RENDERER_ASSET_DIR=/app/renderer \
    RECORDER_LEDGER_PATH=/data/jobs.json \
    RECORDER_DATA_ROOT=/data/captures \
    RECORDER_SEGMENT_SECONDS=30
COPY --from=server /repo/suite/meet/recorder-server/dist ./dist
COPY --from=server /repo/suite/meet/recorder-server/node_modules ./node_modules
COPY --from=server /repo/suite/meet/recorder-server/package.json ./package.json
COPY --from=frontend /repo/frontend/dist-recorder /app/renderer
RUN mkdir -p /data && chown -R node:node /app /data
VOLUME ["/data"]
USER node
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -fsS http://127.0.0.1:3010/ready || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]

FROM runtime AS integration
ENV NODE_ENV=integration
CMD ["node", "dist/integration/CaptureWorker.integration.js"]

FROM runtime AS production
