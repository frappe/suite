#!/usr/bin/env python3
"""Nemotron ASR service for OpenAI clients and session-scoped Meet streams."""

import asyncio
import base64
import binascii
import json
import os
import subprocess
import tempfile
import time
import uuid
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any

import nemo.collections.asr as nemo_asr
import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import (
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from nemo.collections.asr.parts.utils.streaming_utils import CacheAwareStreamingAudioBuffer
from protocol import (
    MODEL_SAMPLE_RATE,
    REALTIME_SAMPLE_RATE,
    bearer_token_matches,
    clean_transcript,
    event_id,
    item_id,
    normalize_language,
    openai_sse_event,
    realtime_error,
    realtime_session,
    transcript_delta,
    validate_session_update,
)
from resampling import StreamingResampler
from runtime import AuthenticatedBodyLimitMiddleware, run_in_thread_serialized

NEMOTRON_MODEL = os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3.5-asr-streaming-0.6b")
NEMOTRON_LANGUAGE = normalize_language(os.getenv("NEMOTRON_LANGUAGE"), "en-US")
NEMOTRON_ATT_CONTEXT_SIZE = os.getenv("NEMOTRON_ATT_CONTEXT_SIZE", "56,3")
NEMOTRON_FINAL_SILENCE_MS = int(os.getenv("NEMOTRON_FINAL_SILENCE_MS", "600"))
STT_STREAM_QUEUE_FRAMES = max(1, int(os.getenv("STT_STREAM_QUEUE_FRAMES", "400")))
STT_API_KEY = os.getenv("STT_API_KEY")
STT_ALLOW_CPU = os.getenv("STT_ALLOW_CPU", "").lower() in {"1", "true", "yes"}
STT_MAX_UPLOAD_BYTES = int(os.getenv("STT_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
STT_MAX_HTTP_BODY_BYTES = STT_MAX_UPLOAD_BYTES + 1024 * 1024
STT_MAX_AUDIO_SECONDS = float(os.getenv("STT_MAX_AUDIO_SECONDS", "300"))
STT_MAX_DECODED_BYTES = int(os.getenv("STT_MAX_DECODED_BYTES", str(256 * 1024 * 1024)))
STT_FFMPEG_TIMEOUT_SECONDS = float(os.getenv("STT_FFMPEG_TIMEOUT_SECONDS", "30"))
STT_REALTIME_MESSAGE_BYTES = int(os.getenv("STT_REALTIME_MESSAGE_BYTES", str(1024 * 1024)))
STT_REALTIME_QUEUE_BYTES = int(os.getenv("STT_REALTIME_QUEUE_BYTES", str(4 * 1024 * 1024)))
STT_REALTIME_UTTERANCE_SECONDS = float(os.getenv("STT_REALTIME_UTTERANCE_SECONDS", "60"))
STT_REALTIME_IDLE_SECONDS = float(os.getenv("STT_REALTIME_IDLE_SECONDS", "30"))
STT_REALTIME_SESSION_SECONDS = float(os.getenv("STT_REALTIME_SESSION_SECONDS", "3600"))
STT_INFERENCE_FAILURE_SECONDS = float(os.getenv("STT_INFERENCE_FAILURE_SECONDS", "60"))

MODEL_ID = NEMOTRON_MODEL.rsplit("/", 1)[-1]
MEL_HOP_SAMPLES = 160

model = None
inference_semaphore: asyncio.Semaphore | None = None
decode_semaphore: asyncio.Semaphore | None = None
ready = False
inference_started_at: float | None = None
last_inference_failure_at: int | None = None


def parse_att_context_size() -> list[int]:
    try:
        parts = [int(part.strip()) for part in NEMOTRON_ATT_CONTEXT_SIZE.strip("[] ").split(",")]
    except ValueError:
        parts = [56, 3]
    return parts if len(parts) == 2 else [56, 3]


def _label(**parts) -> None:
    print("[stt] " + " ".join(f"{key}={value}" for key, value in parts.items()))


def pcm16le_to_float32(audio_bytes: bytes) -> np.ndarray:
    audio_i16 = np.frombuffer(audio_bytes, dtype=np.int16)
    return audio_i16.astype(np.float32) / 32768.0


def model_device():
    try:
        return next(model.parameters()).device
    except (AttributeError, StopIteration):
        return None


def move_to_model_device(value):
    device = model_device()
    if device is not None and torch.is_tensor(value):
        return value.to(device)
    return value


def apply_language(language: str | None) -> str:
    resolved = normalize_language(language, NEMOTRON_LANGUAGE)
    model.set_inference_prompt(resolved)
    return resolved


def load_model() -> None:
    global model
    cuda_available = torch.cuda.is_available()
    if not cuda_available and not STT_ALLOW_CPU:
        raise RuntimeError("CUDA is required; set STT_ALLOW_CPU=1 only for CPU development")
    device = "cuda" if cuda_available else "cpu"
    att_context_size = parse_att_context_size()
    _label(event="model_loading", model=NEMOTRON_MODEL, device=device, language=NEMOTRON_LANGUAGE)
    t0 = time.time()

    model = nemo_asr.models.ASRModel.from_pretrained(NEMOTRON_MODEL).eval()
    if device == "cuda":
        model = model.to("cuda")
    apply_language(NEMOTRON_LANGUAGE)
    model.encoder.set_default_att_context_size(att_context_size)
    _label(event="model_loaded", backend="nemo", context=att_context_size, elapsed=f"{time.time() - t0:.2f}s")


class FinalDecoder:
    """Proven utterance decoder retained as a fallback for incremental failures."""

    def __init__(self):
        self.buffer = CacheAwareStreamingAudioBuffer(model, online_normalization=False)
        self.cfg = model.encoder.streaming_cfg
        self.cache_last_channel, self.cache_last_time, self.cache_last_channel_len = (
            model.encoder.get_initial_cache_state(batch_size=1)
        )
        self.cache_last_channel = move_to_model_device(self.cache_last_channel)
        self.cache_last_time = move_to_model_device(self.cache_last_time)
        self.cache_last_channel_len = move_to_model_device(self.cache_last_channel_len)
        self.previous_hypotheses = None
        self.step = 0
        self.last_text = ""

    def transcribe(self, audio: np.ndarray) -> str:
        if audio.size == 0:
            return ""
        self.buffer.append_audio(audio, stream_id=-1)
        for chunk, chunk_len in self.buffer:
            with torch.inference_mode():
                (
                    _,
                    _,
                    self.cache_last_channel,
                    self.cache_last_time,
                    self.cache_last_channel_len,
                    self.previous_hypotheses,
                ) = model.conformer_stream_step(
                    processed_signal=move_to_model_device(chunk),
                    processed_signal_length=move_to_model_device(chunk_len),
                    cache_last_channel=self.cache_last_channel,
                    cache_last_time=self.cache_last_time,
                    cache_last_channel_len=self.cache_last_channel_len,
                    previous_hypotheses=self.previous_hypotheses,
                    drop_extra_pre_encoded=self.cfg.drop_extra_pre_encoded if self.step else 0,
                    keep_all_outputs=self.buffer.is_buffer_empty(),
                    return_transcription=True,
                )
            self.step += 1
            if self.previous_hypotheses:
                self.last_text = clean_transcript(self.previous_hypotheses[0].text)
        return self.last_text


def final_transcribe(audio: np.ndarray) -> str:
    return FinalDecoder().transcribe(audio)


def _streaming_value(value, step: int = 1):
    if isinstance(value, list | tuple):
        return value[0] if step == 0 or len(value) == 1 else value[1]
    return value


class StreamingFeatureBuffer:
    """Bounded, sample-aligned windows matching NeMo's cache-aware buffer."""

    def __init__(self):
        reference = CacheAwareStreamingAudioBuffer(model, online_normalization=False)
        if reference.model_normalize_type not in (None, "None", "NA"):
            raise ValueError(
                "Bounded streaming requires a model without utterance-wide feature normalization"
            )
        self.preprocess_audio = reference.preprocess_audio
        self.sampling_frames = reference.sampling_frames
        self.cfg = reference.streaming_cfg
        self.feature_count = reference.input_features
        self.right_samples = int(model.cfg.preprocessor.n_fft) // 2
        # Align the crop to the original hop grid, including pre-emphasis's
        # previous sample. Never expose an STFT frame before its right context.
        self.left_frames = (self.right_samples + 1 + MEL_HOP_SAMPLES - 1) // MEL_HOP_SAMPLES
        for step in (0, 1):
            if _streaming_value(self.cfg.chunk_size, step) != _streaming_value(self.cfg.shift_size, step):
                raise ValueError("Bounded streaming requires non-overlapping feature chunks")
        self.cache_frames = max(_streaming_value(self.cfg.pre_encode_cache_size, step) for step in (0, 1))
        self.reset()

    def reset(self) -> None:
        self.audio = np.zeros(0, dtype=np.float32)
        self.sample_offset = 0
        self.total_samples = 0
        self.frame_offset = 0
        self.step = 0
        self.history = torch.zeros(
            (1, self.feature_count, self.cache_frames), device=model_device(), dtype=torch.float32
        )

    def append(self, samples: np.ndarray) -> None:
        if samples.size:
            self.audio = np.concatenate((self.audio, samples))
            self.total_samples += samples.size

    def pop_chunk(self, final: bool):
        if not self.audio.size:
            return None
        chunk_frames = int(_streaming_value(self.cfg.chunk_size, self.step))
        end_frame = self.frame_offset + chunk_frames
        required_samples = (end_frame - 1) * MEL_HOP_SAMPLES + self.right_samples
        if not final and self.total_samples < required_samples:
            return None
        start_frame = max(0, self.frame_offset - self.left_frames)
        start_sample = start_frame * MEL_HOP_SAMPLES
        end_sample = self.total_samples if final else required_samples
        window = self.audio[start_sample - self.sample_offset : end_sample - self.sample_offset]
        with torch.inference_mode():
            features, _ = self.preprocess_audio(window)
        total_frames = start_frame + features.shape[-1]
        current = features[:, :, self.frame_offset - start_frame : end_frame - start_frame]
        minimum_frames = (
            int(_streaming_value(self.sampling_frames, self.step)) if self.sampling_frames is not None else 1
        )
        if current.shape[-1] < minimum_frames:
            return None
        cache_frames = int(_streaming_value(self.cfg.pre_encode_cache_size, self.step))
        history = self.history[:, :, -cache_frames:] if cache_frames else self.history[:, :, :0]
        processed = torch.cat((history, current), dim=-1)
        length = torch.tensor([processed.shape[-1]], device=processed.device)
        next_frame = self.frame_offset + int(_streaming_value(self.cfg.shift_size, self.step))
        is_last = final and next_frame >= total_frames
        if self.cache_frames:
            self.history = torch.cat((self.history, current), dim=-1)[:, :, -self.cache_frames :].clone()
        self.frame_offset = next_frame
        self.step += 1
        keep_from = min(self.total_samples, max(0, next_frame - self.left_frames) * MEL_HOP_SAMPLES)
        self.audio = self.audio[keep_from - self.sample_offset :].copy()
        self.sample_offset = keep_from
        return processed, length, is_last


class IncrementalDecoder:
    """Stateful decoder that owns one stream's encoder cache and hypothesis."""

    def __init__(self):
        streaming_cfg = model.encoder.streaming_cfg
        self.chunk_samples = int(_streaming_value(streaming_cfg.chunk_size)) * MEL_HOP_SAMPLES
        self.drop_extra_pre_encoded = streaming_cfg.drop_extra_pre_encoded
        self.features = StreamingFeatureBuffer()
        self.reset()

    def reset(self) -> None:
        self.cache_last_channel, self.cache_last_time, self.cache_last_channel_len = (
            model.encoder.get_initial_cache_state(batch_size=1)
        )
        self.cache_last_channel = move_to_model_device(self.cache_last_channel)
        self.cache_last_time = move_to_model_device(self.cache_last_time)
        self.cache_last_channel_len = move_to_model_device(self.cache_last_channel_len)
        self.previous_hypotheses = None
        self.current_text = ""
        self.step = 0
        self.features.reset()

    def feed(self, audio: np.ndarray) -> str:
        # Limit storage even when a caller submits a large audio packet.
        for offset in range(0, len(audio), self.chunk_samples):
            self.features.append(audio[offset : offset + self.chunk_samples])
            self._drain(final=False)
        return self.current_text

    def flush(self) -> str:
        self._drain(final=True)
        final = self.current_text.strip()
        self.reset()
        return final

    def _drain(self, final: bool) -> None:
        while (chunk := self.features.pop_chunk(final)) is not None:
            self.current_text = self._process_chunk(*chunk)

    def _process_chunk(self, processed, processed_len, is_final: bool) -> str:
        with torch.inference_mode():
            (
                _,
                _,
                self.cache_last_channel,
                self.cache_last_time,
                self.cache_last_channel_len,
                best_hypotheses,
            ) = model.conformer_stream_step(
                processed_signal=processed,
                processed_signal_length=processed_len,
                cache_last_channel=self.cache_last_channel,
                cache_last_time=self.cache_last_time,
                cache_last_channel_len=self.cache_last_channel_len,
                keep_all_outputs=is_final,
                previous_hypotheses=self.previous_hypotheses,
                drop_extra_pre_encoded=self.drop_extra_pre_encoded if self.step else 0,
                return_transcription=True,
            )
        self.step += 1
        self.previous_hypotheses = best_hypotheses
        if best_hypotheses:
            return clean_transcript(best_hypotheses[0].text)
        return self.current_text


class RealtimeTranscriptionSession:
    def __init__(self, language: str):
        self.language = language or NEMOTRON_LANGUAGE
        self.last_sent_text = ""
        # Keep fallback audio without growing RAM with utterance duration.
        self.fallback_audio = tempfile.SpooledTemporaryFile(max_size=1024 * 1024)
        self.input_sample_count = 0
        self.resampler = StreamingResampler(REALTIME_SAMPLE_RATE, MODEL_SAMPLE_RATE)
        self.incremental_decoder = IncrementalDecoder()
        self.incremental_failed = False
        self.last_final_used_fallback = False

    def append_and_decode(self, audio_bytes: bytes) -> str:
        audio = pcm16le_to_float32(audio_bytes)
        self.input_sample_count += len(audio)
        audio = self.resampler.process(audio)
        if audio.size:
            self.fallback_audio.write(audio.tobytes())
        if self.incremental_failed:
            return ""
        try:
            return self.incremental_decoder.feed(audio)
        except Exception as incremental_error:
            self.incremental_failed = True
            _label(event="incremental_fallback", error=str(incremental_error))
            return ""

    def finalize(self) -> str:
        self.last_final_used_fallback = False
        try:
            if not self.has_audio:
                return ""
            tail = self.resampler.flush()
            if tail.size:
                self.fallback_audio.write(tail.tobytes())
            silence_samples = max(0, int(MODEL_SAMPLE_RATE * NEMOTRON_FINAL_SILENCE_MS / 1000))
            if not self.incremental_failed:
                try:
                    self.incremental_decoder.feed(tail)
                    self.incremental_decoder.feed(np.zeros(silence_samples, dtype=np.float32))
                    return self.incremental_decoder.flush()
                except Exception as incremental_error:
                    _label(event="incremental_final_fallback", error=str(incremental_error))
            self.last_final_used_fallback = True
            self.fallback_audio.seek(0)
            audio = np.frombuffer(self.fallback_audio.read(), dtype=np.float32)
            return FinalDecoder().transcribe(np.pad(audio, (0, silence_samples)))
        finally:
            self.reset_utterance()
            self.incremental_decoder.reset()

    def audio_duration_seconds(self) -> float:
        return self.input_sample_count / REALTIME_SAMPLE_RATE

    @property
    def has_audio(self) -> bool:
        return self.input_sample_count > 0

    def clear(self) -> None:
        self.incremental_decoder.reset()
        self.reset_utterance()

    def reset_utterance(self) -> None:
        self.last_sent_text = ""
        self.fallback_audio.close()
        self.fallback_audio = tempfile.SpooledTemporaryFile(max_size=1024 * 1024)
        self.input_sample_count = 0
        self.resampler = StreamingResampler(REALTIME_SAMPLE_RATE, MODEL_SAMPLE_RATE)
        self.incremental_failed = False

    def close(self) -> None:
        self.fallback_audio.close()


def _run_with_language(language: str, operation: Callable[..., Any], *args):
    global inference_started_at, last_inference_failure_at
    inference_started_at = time.monotonic()
    try:
        apply_language(language)
        return operation(*args)
    except Exception:
        last_inference_failure_at = int(time.time())
        raise
    finally:
        inference_started_at = None


async def run_inference(language: str, operation: Callable[..., Any], *args):
    if inference_semaphore is None:
        raise RuntimeError("Inference service is not initialized")
    return await run_in_thread_serialized(inference_semaphore, _run_with_language, language, operation, *args)


class AudioLimitError(ValueError):
    pass


def load_uploaded_audio(audio_bytes: bytes, filename: str) -> np.ndarray:
    suffix = os.path.splitext(filename)[1] or ".wav"
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, f"audio{suffix}")
        with open(path, "wb") as audio_file:
            audio_file.write(audio_bytes)
        try:
            info = sf.info(path)
            if info.samplerate <= 0 or info.channels <= 0:
                raise AudioLimitError("Invalid audio stream metadata")
            if info.duration > STT_MAX_AUDIO_SECONDS:
                raise AudioLimitError(f"Audio exceeds the {STT_MAX_AUDIO_SECONDS:g} second limit")
            if info.frames * info.channels * 4 > STT_MAX_DECODED_BYTES:
                raise AudioLimitError("Decoded audio exceeds the size limit")
            audio, sample_rate = sf.read(path, dtype="float32")
        except AudioLimitError:
            raise
        except Exception:
            decoded_path = os.path.join(directory, "decoded.f32")
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    path,
                    "-t",
                    str(STT_MAX_AUDIO_SECONDS + 1),
                    "-f",
                    "f32le",
                    "-ac",
                    "1",
                    "-ar",
                    str(MODEL_SAMPLE_RATE),
                    "-y",
                    decoded_path,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=STT_FFMPEG_TIMEOUT_SECONDS,
            )
            decoded_size = os.path.getsize(decoded_path)
            max_samples = int(STT_MAX_AUDIO_SECONDS * MODEL_SAMPLE_RATE)
            if decoded_size > max_samples * 4:
                raise ValueError(f"Audio exceeds the {STT_MAX_AUDIO_SECONDS:g} second limit")
            if decoded_size > STT_MAX_DECODED_BYTES:
                raise ValueError("Decoded audio exceeds the size limit")
            with open(decoded_path, "rb") as decoded_file:
                return np.frombuffer(decoded_file.read(), dtype=np.float32).copy()

    if audio.ndim > 1:
        audio = audio.mean(axis=-1) if audio.shape[-1] <= audio.shape[0] else audio.mean(axis=0)
    if sample_rate != MODEL_SAMPLE_RATE:
        import librosa

        audio = librosa.resample(
            np.asarray(audio, dtype=np.float32),
            orig_sr=sample_rate,
            target_sr=MODEL_SAMPLE_RATE,
        )
    audio = np.asarray(audio, dtype=np.float32)
    if audio.size > int(STT_MAX_AUDIO_SECONDS * MODEL_SAMPLE_RATE):
        raise ValueError(f"Audio exceeds the {STT_MAX_AUDIO_SECONDS:g} second limit")
    if audio.nbytes > STT_MAX_DECODED_BYTES:
        raise ValueError("Decoded audio exceeds the size limit")
    return audio


async def read_upload_limited(file: UploadFile) -> bytes:
    if file.size is not None and file.size > STT_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio upload is too large")
    chunks = []
    total = 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > STT_MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Audio upload is too large")
        chunks.append(chunk)
    return b"".join(chunks)


def run_warmup() -> None:
    t0 = time.time()
    _run_with_language(NEMOTRON_LANGUAGE, final_transcribe, np.zeros(MODEL_SAMPLE_RATE, dtype=np.float32))
    _label(event="warmup", elapsed=f"{time.time() - t0:.2f}s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global decode_semaphore, inference_semaphore, ready
    if not STT_API_KEY:
        raise RuntimeError("STT_API_KEY is required")
    load_model()
    decode_semaphore = asyncio.Semaphore(2)
    inference_semaphore = asyncio.Semaphore(1)
    await asyncio.to_thread(run_warmup)
    ready = True
    _label(event="ready", max_concurrency=1)
    try:
        yield
    finally:
        ready = False


app = FastAPI(title="Nemotron STT Server", lifespan=lifespan)
app.add_middleware(
    AuthenticatedBodyLimitMiddleware,
    path="/v1/audio/transcriptions",
    max_bytes=STT_MAX_HTTP_BODY_BYTES,
    authorize=lambda value: bearer_token_matches(value, STT_API_KEY),
)


@app.get("/health")
async def health():
    if not ready:
        return JSONResponse(
            {"status": "loading", "backend": "nemo", "model": NEMOTRON_MODEL},
            status_code=503,
        )
    busy_for = time.monotonic() - inference_started_at if inference_started_at is not None else None
    recent_failure = bool(
        last_inference_failure_at and time.time() - last_inference_failure_at <= STT_INFERENCE_FAILURE_SECONDS
    )
    return {
        "status": "busy" if busy_for is not None else "degraded" if recent_failure else "ok",
        "backend": "nemo",
        "model": NEMOTRON_MODEL,
        "inference_active_seconds": round(busy_for, 1) if busy_for is not None else None,
        "recent_inference_failure": recent_failure,
    }


@app.get("/v1/models")
async def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": MODEL_ID,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "nvidia",
            }
        ],
    }


@app.post("/v1/audio/transcriptions")
async def transcribe_audio_file(
    file: Annotated[UploadFile, File()],
    authorization: Annotated[str | None, Header()] = None,
    model_name: Annotated[str, Form(alias="model")] = MODEL_ID,
    response_format: Annotated[str, Form()] = "json",
    stream: Annotated[bool, Form()] = False,
    language: Annotated[str | None, Form()] = None,
    temperature: Annotated[str | None, Form()] = None,
    prompt: Annotated[str | None, Form()] = None,
):
    if not ready or model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    if model_name not in {MODEL_ID, NEMOTRON_MODEL}:
        raise HTTPException(status_code=400, detail=f"Unsupported model: {model_name}")
    if response_format not in {"json", "text", "verbose_json"}:
        raise HTTPException(status_code=400, detail=f"Unsupported response_format: {response_format}")
    audio_bytes = await read_upload_limited(file)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    try:
        if decode_semaphore is None:
            raise RuntimeError("Decode service is not initialized")
        audio = await run_in_thread_serialized(
            decode_semaphore, load_uploaded_audio, audio_bytes, file.filename or "audio.wav"
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Failed to process audio: {error}") from error

    resolved_language = normalize_language(language, NEMOTRON_LANGUAGE)
    duration = len(audio) / MODEL_SAMPLE_RATE
    if stream:

        async def event_stream() -> AsyncGenerator[str]:
            decoder = await run_inference(resolved_language, IncrementalDecoder)
            previous = ""
            for offset in range(0, len(audio), decoder.chunk_samples):
                current = await run_inference(
                    resolved_language,
                    decoder.feed,
                    audio[offset : offset + decoder.chunk_samples],
                )
                if delta := transcript_delta(previous, current):
                    yield openai_sse_event({"type": "transcript.text.delta", "delta": delta})
                    previous = current
            final = await run_inference(resolved_language, decoder.flush)
            if delta := transcript_delta(previous, final):
                yield openai_sse_event({"type": "transcript.text.delta", "delta": delta})
            yield openai_sse_event({"type": "transcript.text.done", "text": final})
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    text = await run_inference(resolved_language, final_transcribe, audio)
    if response_format == "text":
        return PlainTextResponse(text)
    if response_format == "verbose_json":
        return {
            "text": text,
            "task": "transcribe",
            "language": resolved_language,
            "duration": duration,
        }
    return {"text": text}


@app.websocket("/v1/realtime")
async def realtime_transcription(websocket: WebSocket):
    if not bearer_token_matches(websocket.headers.get("authorization"), STT_API_KEY):
        await websocket.close(code=1008, reason="Unauthorized")
        return
    await websocket.accept()
    if not ready or model is None:
        await websocket.send_json(realtime_error("Model not loaded", code="server_not_ready"))
        await websocket.close(code=1013, reason="Model not loaded")
        return

    requested_model = websocket.query_params.get("model") or MODEL_ID
    if requested_model not in {MODEL_ID, NEMOTRON_MODEL}:
        await websocket.send_json(realtime_error(f"Unsupported transcription model: {requested_model}"))
        await websocket.close(code=1008, reason="Unsupported model")
        return

    realtime_session_id = f"sess_{uuid.uuid4().hex}"
    effective_session = realtime_session(realtime_session_id, requested_model, NEMOTRON_LANGUAGE)
    await websocket.send_json(
        {
            "event_id": event_id(),
            "type": "session.created",
            "session": effective_session,
        }
    )

    transcription: RealtimeTranscriptionSession | None = None
    reader_task: asyncio.Task | None = None
    worker_task: asyncio.Task | None = None
    current_item_id = item_id()
    previous_item_id: str | None = None
    try:
        queue: asyncio.Queue[tuple[str, int] | None] = asyncio.Queue(maxsize=STT_STREAM_QUEUE_FRAMES)
        closed = asyncio.Event()
        queued_bytes = 0
        session_deadline = time.monotonic() + STT_REALTIME_SESSION_SECONDS
        _label(event="realtime_start", session=realtime_session_id, model=requested_model)

        async def reader() -> None:
            nonlocal queued_bytes
            try:
                while not closed.is_set():
                    remaining = session_deadline - time.monotonic()
                    if remaining <= 0:
                        await websocket.close(code=1008, reason="Session time limit reached")
                        break
                    try:
                        message = await asyncio.wait_for(
                            websocket.receive(), timeout=min(STT_REALTIME_IDLE_SECONDS, remaining)
                        )
                    except TimeoutError:
                        await websocket.close(code=1008, reason="Realtime session idle timeout")
                        break
                    if message["type"] == "websocket.disconnect":
                        break
                    if message.get("bytes") is not None:
                        if len(message["bytes"]) > STT_REALTIME_MESSAGE_BYTES:
                            await websocket.close(code=1009, reason="WebSocket message is too large")
                            break
                        await websocket.send_json(
                            realtime_error("Binary WebSocket messages are not supported")
                        )
                    elif message.get("text") is not None:
                        message_bytes = len(message["text"].encode("utf-8"))
                        if message_bytes > STT_REALTIME_MESSAGE_BYTES:
                            await websocket.close(code=1009, reason="WebSocket message is too large")
                            break
                        if queued_bytes + message_bytes > STT_REALTIME_QUEUE_BYTES:
                            await websocket.close(code=1009, reason="WebSocket queue byte limit reached")
                            break
                        queued_bytes += message_bytes
                        await queue.put((message["text"], message_bytes))
            except WebSocketDisconnect:
                pass
            finally:
                closed.set()
                try:
                    queue.put_nowait(None)
                except asyncio.QueueFull:
                    pass

        async def worker() -> None:
            nonlocal transcription, effective_session, current_item_id, previous_item_id, queued_bytes
            while not closed.is_set():
                queued = await queue.get()
                try:
                    if queued is None:
                        return
                    payload, message_bytes = queued
                    queued_bytes -= message_bytes
                    try:
                        client_event = json.loads(payload)
                    except json.JSONDecodeError:
                        await websocket.send_json(realtime_error("Invalid JSON event"))
                        continue
                    if not isinstance(client_event, dict):
                        await websocket.send_json(realtime_error("WebSocket events must be JSON objects"))
                        continue

                    client_event_id = client_event.get("event_id")
                    event_type = client_event.get("type")
                    if event_type == "session.update":
                        config, error = validate_session_update(
                            client_event,
                            {MODEL_ID, NEMOTRON_MODEL},
                            effective_session["audio"]["input"]["transcription"]["model"],
                            effective_session["audio"]["input"]["transcription"]["language"],
                        )
                        if error:
                            await websocket.send_json(realtime_error(error, client_event_id))
                            continue
                        language = config.get("language") or NEMOTRON_LANGUAGE
                        if transcription is None:
                            transcription = await run_inference(
                                language, RealtimeTranscriptionSession, language
                            )
                        elif transcription.has_audio:
                            await websocket.send_json(
                                realtime_error(
                                    "Cannot update the session while audio is buffered", client_event_id
                                )
                            )
                            continue
                        else:
                            transcription.language = language
                        effective_session = realtime_session(realtime_session_id, config["model"], language)
                        await websocket.send_json(
                            {
                                "event_id": event_id(),
                                "type": "session.updated",
                                "session": effective_session,
                            }
                        )
                        continue

                    if transcription is None:
                        await websocket.send_json(
                            realtime_error("Send a valid session.update before audio events", client_event_id)
                        )
                        continue

                    if event_type == "input_audio_buffer.append":
                        try:
                            encoded_audio = client_event.get("audio")
                            if not isinstance(encoded_audio, str):
                                raise ValueError("audio must be a base64 string")
                            remaining_audio_bytes = (
                                int(STT_REALTIME_UTTERANCE_SECONDS * REALTIME_SAMPLE_RATE) * 2
                                - transcription.input_sample_count * 2
                            )
                            if len(encoded_audio) > 4 * ((max(0, remaining_audio_bytes) + 2) // 3):
                                raise ValueError(
                                    f"Audio buffer exceeds the {STT_REALTIME_UTTERANCE_SECONDS:g} second limit"
                                )
                            audio_bytes = base64.b64decode(encoded_audio, validate=True)
                            if not audio_bytes or len(audio_bytes) % 2:
                                raise ValueError("audio must contain PCM16 samples")
                            if len(audio_bytes) > remaining_audio_bytes:
                                raise ValueError(
                                    f"Audio buffer exceeds the {STT_REALTIME_UTTERANCE_SECONDS:g} second limit"
                                )
                        except (binascii.Error, ValueError) as decode_error:
                            await websocket.send_json(realtime_error(str(decode_error), client_event_id))
                            continue
                        text = await run_inference(
                            transcription.language,
                            transcription.append_and_decode,
                            audio_bytes,
                        )
                        if closed.is_set():
                            return
                        if delta := transcript_delta(transcription.last_sent_text, text):
                            transcription.last_sent_text = text
                            await websocket.send_json(
                                {
                                    "event_id": event_id(),
                                    "type": "conversation.item.input_audio_transcription.delta",
                                    "item_id": current_item_id,
                                    "content_index": 0,
                                    "delta": delta,
                                    "logprobs": None,
                                }
                            )
                        continue

                    if event_type == "input_audio_buffer.clear":
                        await run_inference(transcription.language, transcription.clear)
                        if closed.is_set():
                            return
                        current_item_id = item_id()
                        await websocket.send_json(
                            {"event_id": event_id(), "type": "input_audio_buffer.cleared"}
                        )
                        continue

                    if event_type == "input_audio_buffer.commit":
                        if not transcription.has_audio:
                            await websocket.send_json(
                                realtime_error("Cannot commit an empty audio buffer", client_event_id)
                            )
                            continue
                        committed_item_id = current_item_id
                        audio_seconds = transcription.audio_duration_seconds()
                        await websocket.send_json(
                            {
                                "event_id": event_id(),
                                "type": "input_audio_buffer.committed",
                                "previous_item_id": previous_item_id,
                                "item_id": committed_item_id,
                            }
                        )
                        previous_text = transcription.last_sent_text
                        t0 = time.time()
                        try:
                            text = await run_inference(transcription.language, transcription.finalize)
                        except Exception as inference_error:
                            if closed.is_set():
                                return
                            await websocket.send_json(
                                {
                                    "event_id": event_id(),
                                    "type": "conversation.item.input_audio_transcription.failed",
                                    "item_id": committed_item_id,
                                    "content_index": 0,
                                    "error": {
                                        "type": "server_error",
                                        "code": "transcription_failed",
                                        "message": str(inference_error),
                                        "param": None,
                                    },
                                }
                            )
                            continue
                        if closed.is_set():
                            return
                        _label(
                            event="realtime_final",
                            session=realtime_session_id,
                            audio_seconds=f"{audio_seconds:.1f}",
                            text_len=len(text),
                            elapsed=f"{time.time() - t0:.2f}s",
                            fallback=transcription.last_final_used_fallback,
                        )
                        if delta := transcript_delta(previous_text, text):
                            await websocket.send_json(
                                {
                                    "event_id": event_id(),
                                    "type": "conversation.item.input_audio_transcription.delta",
                                    "item_id": committed_item_id,
                                    "content_index": 0,
                                    "delta": delta,
                                    "logprobs": None,
                                }
                            )
                        await websocket.send_json(
                            {
                                "event_id": event_id(),
                                "type": "conversation.item.input_audio_transcription.completed",
                                "item_id": committed_item_id,
                                "content_index": 0,
                                "transcript": text,
                                "usage": {"type": "duration", "seconds": audio_seconds},
                                "logprobs": None,
                            }
                        )
                        previous_item_id = committed_item_id
                        current_item_id = item_id()
                        continue

                    await websocket.send_json(
                        realtime_error(f"Unsupported event type: {event_type}", client_event_id)
                    )
                finally:
                    queue.task_done()

        reader_task = asyncio.create_task(reader())
        worker_task = asyncio.create_task(worker())
        done, _ = await asyncio.wait(
            [reader_task, worker_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        if worker_task in done:
            closed.set()
            reader_task.cancel()
            try:
                await reader_task
            except asyncio.CancelledError:
                pass
        else:
            await worker_task
        if reader_task.done() and not reader_task.cancelled():
            reader_task.result()
        worker_task.result()
    except WebSocketDisconnect:
        pass
    finally:
        tasks = [task for task in (reader_task, worker_task) if task is not None]
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if transcription is not None:
            transcription.close()
        _label(event="realtime_end", session=realtime_session_id)


if __name__ == "__main__":
    host = os.getenv("STT_HOST", "127.0.0.1")
    port = int(os.getenv("STT_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, ws_max_size=STT_REALTIME_MESSAGE_BYTES)
