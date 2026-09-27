# Nemotron STT Runtime

GPU inference image for Frappe Meet captions using NVIDIA Nemotron 3.5 ASR through NeMo.

## Runtime Contract

- Container port: `8000`
- Health check: `GET /health`
- OpenAI Realtime transcription: `WS /v1/realtime`
- GPU: NVIDIA CUDA-compatible GPU

The model is downloaded at startup. Mount `/models` to persist the Hugging Face, NeMo, and Torch caches across container replacements.

## Configuration

| Variable | Default |
|---|---|
| `STT_HOST` | `0.0.0.0` |
| `STT_PORT` | `8000` |
| `NEMOTRON_MODEL` | `nvidia/nemotron-3.5-asr-streaming-0.6b` |
| `NEMOTRON_LANGUAGE` | `en-US` |
| `NEMOTRON_ATT_CONTEXT_SIZE` | `56,3` |
| `NEMOTRON_FINAL_SILENCE_MS` | `600` |
| `STT_STREAM_QUEUE_FRAMES` | `400` |
| `STT_API_KEY` | required |
| `STT_ALLOW_CPU` | unset (CUDA required) |
| `STT_REALTIME_MESSAGE_BYTES` | `1048576` (1 MiB) |
| `STT_REALTIME_QUEUE_BYTES` | `4194304` (4 MiB) |
| `STT_REALTIME_UTTERANCE_SECONDS` | `60` |
| `STT_REALTIME_IDLE_SECONDS` | `30` |
| `STT_REALTIME_SESSION_SECONDS` | `3600` |
| `STT_INFERENCE_FAILURE_SECONDS` | `60` |
| `HF_TOKEN` | unset |

## Realtime API

Connect to `/v1/realtime` with the bearer token, send a transcription `session.update` configured for 24 kHz PCM16 mono, append base64 audio with `input_audio_buffer.append`, and finalize turns with `input_audio_buffer.commit`. The server emits Realtime transcription delta and completed events. Startup fails when `STT_API_KEY` is unset. CUDA is also required unless `STT_ALLOW_CPU=1` is explicitly set for development.

## Run

```bash
docker run --rm --gpus all \
  -p 8000:8000 \
  -e STT_API_KEY="$STT_API_KEY" \
  -v nemotron-models:/models \
  ghcr.io/frappe/suite/nemotron-stt:<tag>
```

Pull requests affecting the runtime run lightweight protocol, cancellation, and resampling tests without building or publishing an image. Pushes to `develop` publish `develop` and short-SHA tags after the same tests; manual runs additionally publish the requested tag.
