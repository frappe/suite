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

USER runner
