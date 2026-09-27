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
| `STT_MAX_STREAMS` | `8` (simultaneously transcribed utterances per replica) |
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

Configured SFU streams send a `session.ping` event every 15 seconds to keep quiet
participants connected without adding silence to the model. If changing
`STT_REALTIME_IDLE_SECONDS`, keep it above 15 seconds. The one-hour session
limit still applies; the SFU reconnects when a session expires.
The server advertises `X-STT-Session-Ping: 1` on successful `/health` responses;
the SFU sends the custom event only when the backend advertises support.
When `STT_MAX_STREAMS` is reached, new speaking streams are rejected without
queuing GPU work. Quiet streams neither occupy slots nor allocate decoder
state; state is released after each utterance. Provision more replicas for
rooms exceeding the per-replica capacity.

## Run

```bash
docker run --rm --gpus all \
  -p 8000:8000 \
  -e STT_API_KEY="$STT_API_KEY" \
  -v nemotron-models:/models \
  ghcr.io/frappe/suite/nemotron-stt:<tag>
```

Pull requests affecting the runtime run lightweight protocol, cancellation, and resampling tests without building or publishing an image. Pushes to `develop` publish `develop` and short-SHA tags after the same tests; manual runs additionally publish the requested tag.

## Caption vocabulary hints

Meet sends a bounded snapshot of participant display names over the authenticated
SFU-to-STT Realtime session. The STT decoder also biases the explicit Frappe
product glossary in `context_bias.py`. Hints are applied during Nemotron's
multilingual RNN-T decoding, never by replacing transcript text. Names refresh
at the next utterance after a participant joins or leaves; an utterance already
in progress keeps its initial roster. The shared decoder is configured once,
and per-utterance name models are released on finalize, clear or close.
If a room-name phrase model cannot be built, streaming continues with the
low-weight shared terminology hints rather than dropping speech.
Name hints use weight 1.5 and shared terminology uses a gentler 0.35 to avoid
inserting unrelated Frappe terms into ordinary speech. The offline name pilot
recovered 2/6 difficult names at that weight without the wrong-person
substitution seen at weight 2. This is not a guarantee against substitutions
in real speech; monitor false names and first-caption latency before increasing
the weight or glossary.
