# Nemotron STT Runtime

GPU inference image for Frappe Meet captions using NVIDIA Nemotron 3.5 ASR through NeMo.

## Runtime Contract

- Container port: `8000`
- Health check: `GET /health`
- OpenAI transcription: `POST /v1/audio/transcriptions`
- OpenAI Realtime transcription: `WS /v1/realtime`
- Model listing: `GET /v1/models`
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
| `HF_TOKEN` | unset |

## OpenAI-Compatible API

```bash
curl http://localhost:8000/v1/audio/transcriptions \
  -F file=@audio.wav \
  -F model=nemotron-3.5-asr-streaming-0.6b \
  -F language=en-US
```

Set `stream=true` to receive `transcript.text.delta` and `transcript.text.done` Server-Sent Events.

For live input, connect to `/v1/realtime`, send a transcription `session.update` configured for 24 kHz PCM16 mono, append base64 audio with `input_audio_buffer.append`, and finalize turns with `input_audio_buffer.commit`. The server emits OpenAI Realtime transcription delta and completed events. Authentication is expected to be enforced by the private deployment boundary.

## Run

```bash
docker run --rm --gpus all \
  -p 8000:8000 \
  -v nemotron-models:/models \
  ghcr.io/frappe/suite/nemotron-stt:<tag>
```

The PR workflow publishes same-repository pull requests as `pr-<number>` and all feature branches as both their branch name and short commit SHA. Fork branches publish under the fork owner's GHCR namespace.
