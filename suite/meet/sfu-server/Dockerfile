ARG NODE_VERSION=24-bookworm-slim

# --- Build stage (installs build deps & compiles native modules) ---
FROM node:${NODE_VERSION} AS build
WORKDIR /app
# Install build dependencies for mediasoup (glibc base so prebuilt usually works; still keep toolchain)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential python3-pip pkg-config libssl-dev git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy the shared types directory
COPY types /app/types

# Copy sfu-server source code
WORKDIR /app/sfu-server
COPY sfu-server/package.json sfu-server/yarn.lock sfu-server/tsconfig.json ./
RUN corepack enable
RUN corepack prepare yarn@1.22.22 --activate
RUN yarn install --frozen-lockfile
COPY sfu-server/src ./src
RUN yarn build

# --- Runtime stage (minimal) ---
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app/sfu-server
ENV NODE_ENV=production \
  PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

# Persistent volumes mount over /data, so initialize its ownership in the image.
RUN mkdir -p /app/sfu-server/logs /data && chown -R node:node /app /data

USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","dist/sfu-server/src/server.js"]
