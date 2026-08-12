# syntax=docker/dockerfile:1

FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS yarn-cache

ENV YARN_CACHE_FOLDER=/var/cache/yarn

WORKDIR /warm

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock root/
COPY frontend/package.json root/frontend/
COPY e2e/package.json e2e/yarn.lock e2e/
COPY suite/meet/sfu-server/package.json suite/meet/sfu-server/yarn.lock sfu/

RUN yarn --cwd root install --frozen-lockfile --ignore-scripts --non-interactive --production=false \
    && yarn --cwd e2e install --frozen-lockfile --ignore-scripts --non-interactive --production=false \
    && yarn --cwd sfu install --frozen-lockfile --ignore-scripts --non-interactive --production=false \
    && rm -rf root/node_modules root/frontend/node_modules e2e/node_modules sfu/node_modules

FROM ghcr.io/actions/actions-runner:2.336.0

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cron \
        curl \
        fonts-liberation \
        git \
        gnupg \
        jq \
        libcairo2-dev \
        libffi-dev \
        libgbm1 \
        libjpeg-dev \
        libmariadb-dev \
        libnss3 \
        libpango1.0-dev \
        libssl-dev \
        libxss1 \
        mariadb-client \
        pkg-config \
        redis-tools \
        sudo \
        unzip \
        xvfb \
        zip \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && printf '%s\n' \
        'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

ENV YARN_CACHE_FOLDER=/var/cache/yarn

COPY --from=yarn-cache --chown=runner:runner /var/cache/yarn/ /var/cache/yarn/

USER runner
