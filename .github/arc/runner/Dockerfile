# syntax=docker/dockerfile:1

FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS yarn-cache

ENV YARN_CACHE_FOLDER=/var/cache/yarn
ENV COREPACK_HOME=/var/cache/corepack

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

ARG PYTHON_VERSION=3.14.7
ARG PYTHON_RELEASE=31064857500
ARG PYTHON_SHA256=76d5ddab6d2dd89a39c06220f6efeda486a48ed481eae97bfc596c74ac3623db
ARG FRAPPE_BENCH_VERSION=5.31.0

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

ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache
ENV PYTHON_ROOT=/opt/hostedtoolcache/Python/${PYTHON_VERSION}/x64
ENV PATH="/opt/hostedtoolcache/Python/${PYTHON_VERSION}/x64/bin:${PATH}"
ENV YARN_CACHE_FOLDER=/var/cache/yarn
ENV COREPACK_HOME=/var/cache/corepack

COPY --from=yarn-cache /usr/local/ /opt/hostedtoolcache/node/24.12.0/x64/
COPY --from=yarn-cache --chown=runner:runner /var/cache/corepack/ /var/cache/corepack/

RUN touch /opt/hostedtoolcache/node/24.12.0/x64.complete

RUN mkdir -p /tmp/python-toolcache \
    && curl -fsSL \
        "https://github.com/actions/python-versions/releases/download/${PYTHON_VERSION}-${PYTHON_RELEASE}/python-${PYTHON_VERSION}-linux-24.04-x64.tar.gz" \
        -o /tmp/python-toolcache/python.tar.gz \
    && echo "${PYTHON_SHA256}  /tmp/python-toolcache/python.tar.gz" | sha256sum -c - \
    && mkdir -p "$PYTHON_ROOT" \
    && tar -xzf /tmp/python-toolcache/python.tar.gz -C "$PYTHON_ROOT" \
    && rm "$PYTHON_ROOT/setup.sh" \
    && ln -s ./bin/python3.14 "$PYTHON_ROOT/python" \
    && ln -s python3.14 "$PYTHON_ROOT/bin/python" \
    && ln -s python3.14 "$PYTHON_ROOT/bin/python314" \
    && touch "$RUNNER_TOOL_CACHE/Python/${PYTHON_VERSION}/x64.complete" \
    && rm -rf /tmp/python-toolcache \
    && chown -R runner:runner "$RUNNER_TOOL_CACHE"

COPY --from=yarn-cache --chown=runner:runner /var/cache/yarn/ /var/cache/yarn/

RUN "$PYTHON_ROOT/bin/python" -m pip install "frappe-bench==$FRAPPE_BENCH_VERSION"

USER runner
