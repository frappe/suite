ARG BASE_IMAGE=nvcr.io/nvidia/pytorch:25.06-py3
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="Frappe Meet Nemotron STT" \
      org.opencontainers.image.description="Nemotron 3.5 ASR runtime for Frappe Meet captions" \
      org.opencontainers.image.source="https://github.com/frappe/suite"

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    NEMO_CACHE_DIR=/models/nemo \
    TORCH_HOME=/models/torch \
    STT_HOST=0.0.0.0 \
    STT_PORT=8000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY server.py protocol.py resampling.py ./

RUN useradd --create-home --uid 10001 stt \
    && mkdir -p /models/huggingface /models/nemo /models/torch \
    && chown -R stt:stt /app /models

USER stt

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15m --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

CMD ["python", "server.py"]
