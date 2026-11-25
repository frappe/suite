FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models/huggingface \
    XDG_CACHE_HOME=/models/cache CUDA_CACHE_PATH=/models/cuda \
    HF_HUB_DISABLE_TELEMETRY=1 TOKENIZERS_PARALLELISM=false \
    TRANSCRIPTION_MODEL_CACHE=/models/huggingface TRANSCRIPTION_PORT=8011
WORKDIR /app
COPY transcription-server/requirements.txt ./
# CPU TorchAudio operations use the matching Torch release; inference stays on CUDA.
RUN python -m pip install --no-deps --index-url https://download.pytorch.org/whl/cpu torchaudio==2.8.0 \
    && python -m pip install -r requirements.txt \
    && python -c "import torch, torchaudio; from transformers import WhisperForConditionalGeneration, WhisperProcessor; assert torch.__version__.split('+')[0] == '2.8.0'"
COPY transcription-server/client.py transcription-server/metrics.py transcription-server/protocol.py transcription-server/recognizer.py transcription-server/server.py transcription-server/worker.py ./
COPY speech_context.py speech-vocabulary.json ./
RUN useradd --create-home --uid 10001 transcription \
    && mkdir -p /models/huggingface && chown -R transcription:transcription /models /app
USER transcription
EXPOSE 8011
HEALTHCHECK --interval=30s --timeout=5s --start-period=15m --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('TRANSCRIPTION_PORT', '8011') + '/health', timeout=4)"]
CMD ["python", "server.py"]
