#!/usr/bin/env python3
"""Nemotron ASR service for OpenAI clients and session-scoped Meet streams."""

import asyncio
import base64
import binascii
import copy
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
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from nemo.collections.asr.parts.preprocessing.features import normalize_batch
from nemo.collections.asr.parts.utils.streaming_utils import CacheAwareStreamingAudioBuffer
from omegaconf import OmegaConf
from protocol import (
    MODEL_SAMPLE_RATE,
    REALTIME_SAMPLE_RATE,
    clean_transcript,
    event_id,
    item_id,
    openai_sse_event,
    realtime_error,
    realtime_session,
    transcript_delta,
    validate_session_update,
)
from resampling import StreamingResampler

NEMOTRON_MODEL = os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3.5-asr-streaming-0.6b")
NEMOTRON_LANGUAGE = os.getenv("NEMOTRON_LANGUAGE", "en-US").strip() or "en-US"
NEMOTRON_ATT_CONTEXT_SIZE = os.getenv("NEMOTRON_ATT_CONTEXT_SIZE", "56,3")
NEMOTRON_FINAL_SILENCE_MS = int(os.getenv("NEMOTRON_FINAL_SILENCE_MS", "600"))
STT_STREAM_QUEUE_FRAMES = max(1, int(os.getenv("STT_STREAM_QUEUE_FRAMES", "400")))

MODEL_ID = NEMOTRON_MODEL.rsplit("/", 1)[-1]
MEL_HOP_SAMPLES = 160

model = None
inference_semaphore: asyncio.Semaphore | None = None
ready = False


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
    resolved = (language or NEMOTRON_LANGUAGE).strip() or NEMOTRON_LANGUAGE
    model.set_inference_prompt(resolved)
    return resolved


def load_model() -> None:
    global model
    device = "cuda" if torch.cuda.is_available() else "cpu"
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


def _streaming_value(value):
    if isinstance(value, list | tuple):
        return value[1] if len(value) > 1 else value[0]
    return value


class StreamingFeatureBuffer:
    """Rolling normalized mel-feature window for cache-aware inference."""

    def __init__(self):
        cfg = copy.deepcopy(model._cfg)
        OmegaConf.set_struct(cfg.preprocessor, False)
        self.normalize_type = cfg.preprocessor.normalize
        cfg.preprocessor.normalize = "None"
        cfg.preprocessor.dither = 0.0
        cfg.preprocessor.pad_to = 0

        streaming_cfg = model.encoder.streaming_cfg
        self.chunk_frames = int(_streaming_value(streaming_cfg.chunk_size))
        self.precache_frames = int(_streaming_value(streaming_cfg.pre_encode_cache_size))
        self.buffer_frames = self.precache_frames + self.chunk_frames
        self.chunk_samples = self.chunk_frames * MEL_HOP_SAMPLES
        self.look_back = 2 * MEL_HOP_SAMPLES
        self.device = model_device()
        self.raw_preprocessor = model.from_config_dict(cfg.preprocessor).to(self.device)
        self.reset()

    def reset(self) -> None:
        self.sample_ring = torch.zeros(
            self.chunk_samples + self.look_back,
            dtype=torch.float32,
            device=self.device,
        )
        silence = torch.zeros(
            self.buffer_frames * MEL_HOP_SAMPLES + self.look_back,
            dtype=torch.float32,
            device=self.device,
        )
        zero_level = self._extract(silence)[:, :1]
        self.feature_buffer = zero_level.repeat(1, self.buffer_frames).contiguous()

    def _extract(self, samples: torch.Tensor) -> torch.Tensor:
        signal = samples.unsqueeze(0)
        length = torch.tensor([samples.shape[0]], device=self.device)
        features, _ = self.raw_preprocessor(input_signal=signal, length=length)
        return features.squeeze(0)

    def update(self, chunk_audio: np.ndarray) -> None:
        chunk = torch.from_numpy(np.ascontiguousarray(chunk_audio)).float().to(self.device)
        self.sample_ring[: -self.chunk_samples] = self.sample_ring[self.chunk_samples :].clone()
        self.sample_ring[-self.chunk_samples :] = chunk
        chunk_features = self._extract(self.sample_ring)[:, -self.chunk_frames :]
        if chunk_features.shape[1] < self.chunk_frames:
            padding = self.feature_buffer[:, -1:].repeat(1, self.chunk_frames - chunk_features.shape[1])
            chunk_features = torch.cat([padding, chunk_features], dim=1)
        self.feature_buffer[:, : -self.chunk_frames] = self.feature_buffer[:, self.chunk_frames :].clone()
        self.feature_buffer[:, -self.chunk_frames :] = chunk_features

    def normalized_window(self):
        features = self.feature_buffer.unsqueeze(0)
        length = torch.tensor([self.buffer_frames], device=self.device)
        normalized, _, _ = normalize_batch(
            x=features,
            seq_len=length,
            normalize_type=self.normalize_type,
        )
        return normalized, length


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
        self.audio_buffer = np.zeros(0, dtype=np.float32)
        self.step = 0
        self.features.reset()

    def feed(self, audio: np.ndarray) -> str:
        if audio.size:
            self.audio_buffer = np.concatenate([self.audio_buffer, audio])
        while len(self.audio_buffer) >= self.chunk_samples:
            chunk = self.audio_buffer[: self.chunk_samples]
            self.audio_buffer = self.audio_buffer[self.chunk_samples :]
            self.current_text = self._process_chunk(chunk)
        return self.current_text

    def flush(self) -> str:
        if self.audio_buffer.size:
            padding = self.chunk_samples - len(self.audio_buffer)
            chunk = np.pad(self.audio_buffer, (0, padding))
            self.current_text = self._process_chunk(chunk, is_final=True)
        final = self.current_text.strip()
        self.reset()
        return final

    def _process_chunk(self, audio: np.ndarray, is_final: bool = False) -> str:
        self.features.update(audio)
        processed, processed_len = self.features.normalized_window()
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
        self.utterance_audio: list[np.ndarray] = []
        self.input_sample_count = 0
        self.resampler = StreamingResampler(REALTIME_SAMPLE_RATE, MODEL_SAMPLE_RATE)
        self.incremental_decoder = IncrementalDecoder()
        self.incremental_failed = False

    def append_and_decode(self, audio_bytes: bytes) -> str:
        audio = pcm16le_to_float32(audio_bytes)
        self.input_sample_count += len(audio)
        audio = self.resampler.process(audio)
        if audio.size:
            self.utterance_audio.append(audio)
        if self.incremental_failed:
            return ""
        try:
            return self.incremental_decoder.feed(audio)
        except Exception as incremental_error:
            self.incremental_failed = True
            _label(event="incremental_fallback", error=str(incremental_error))
            return ""

    def finalize(self) -> str:
        if not self.has_audio:
            self.incremental_decoder.reset()
            self.reset_utterance()
            return ""
        tail = self.resampler.flush()
        if tail.size:
            self.utterance_audio.append(tail)
        audio = np.concatenate(self.utterance_audio)
        if NEMOTRON_FINAL_SILENCE_MS > 0:
            audio = np.pad(
                audio,
                (0, int(MODEL_SAMPLE_RATE * NEMOTRON_FINAL_SILENCE_MS / 1000)),
            )
        text = FinalDecoder().transcribe(audio)
        self.incremental_decoder.reset()
        self.reset_utterance()
        return text

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
        self.utterance_audio = []
        self.input_sample_count = 0
        self.resampler = StreamingResampler(REALTIME_SAMPLE_RATE, MODEL_SAMPLE_RATE)
        self.incremental_failed = False


def _run_with_language(language: str, operation: Callable[..., Any], *args):
    apply_language(language)
    return operation(*args)


async def run_inference(language: str, operation: Callable[..., Any], *args):
    if inference_semaphore is None:
        raise RuntimeError("Inference service is not initialized")
    async with inference_semaphore:
        return await asyncio.to_thread(_run_with_language, language, operation, *args)


def direct_transcribe(audio: np.ndarray) -> str:
    device = model_device()
    audio_tensor = torch.from_numpy(np.ascontiguousarray(audio)).float().unsqueeze(0).to(device)
    audio_len = torch.tensor([audio.shape[0]], dtype=torch.long, device=device)
    with torch.inference_mode():
        processed, processed_len = model.preprocessor(input_signal=audio_tensor, length=audio_len)
        encoded, encoded_len = model.encoder(audio_signal=processed, length=processed_len)
        hypotheses = model.decoding.rnnt_decoder_predictions_tensor(
            encoded,
            encoded_len,
            return_hypotheses=False,
        )
    hypothesis = hypotheses[0]
    return clean_transcript(hypothesis.text if hasattr(hypothesis, "text") else str(hypothesis))


def load_uploaded_audio(audio_bytes: bytes, filename: str) -> np.ndarray:
    suffix = os.path.splitext(filename)[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as audio_file:
        audio_file.write(audio_bytes)
        path = audio_file.name
    try:
        try:
            audio, sample_rate = sf.read(path, dtype="float32")
        except Exception:
            decoded = subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    path,
                    "-f",
                    "f32le",
                    "-ac",
                    "1",
                    "-ar",
                    str(MODEL_SAMPLE_RATE),
                    "pipe:1",
                ],
                check=True,
                capture_output=True,
            )
            return np.frombuffer(decoded.stdout, dtype=np.float32).copy()
    finally:
        os.unlink(path)

    if audio.ndim > 1:
        audio = audio.mean(axis=-1) if audio.shape[-1] <= audio.shape[0] else audio.mean(axis=0)
    if sample_rate != MODEL_SAMPLE_RATE:
        import librosa

        audio = librosa.resample(
            np.asarray(audio, dtype=np.float32),
            orig_sr=sample_rate,
            target_sr=MODEL_SAMPLE_RATE,
        )
    return np.asarray(audio, dtype=np.float32)


def run_warmup() -> None:
    t0 = time.time()
    _run_with_language(NEMOTRON_LANGUAGE, direct_transcribe, np.zeros(MODEL_SAMPLE_RATE, dtype=np.float32))
    _label(event="warmup", elapsed=f"{time.time() - t0:.2f}s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global inference_semaphore, ready
    load_model()
    inference_semaphore = asyncio.Semaphore(1)
    try:
        await asyncio.to_thread(run_warmup)
    finally:
        ready = True
    _label(event="ready", max_concurrency=1)
    yield
    ready = False


app = FastAPI(title="Nemotron STT Server", lifespan=lifespan)


@app.get("/health")
async def health():
    if not ready:
        return JSONResponse(
            {"status": "loading", "backend": "nemo", "model": NEMOTRON_MODEL},
            status_code=503,
        )
    return {"status": "ok", "backend": "nemo", "model": NEMOTRON_MODEL}


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
    model_name: Annotated[str, Form(alias="model")] = MODEL_ID,
    response_format: Annotated[str, Form()] = "json",
    stream: Annotated[bool, Form()] = False,
    language: Annotated[str | None, Form()] = None,
    temperature: Annotated[str | None, Form()] = None,
    prompt: Annotated[str | None, Form()] = None,
):
    del temperature, prompt
    if not ready or model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    if model_name not in {MODEL_ID, NEMOTRON_MODEL}:
        raise HTTPException(status_code=400, detail=f"Unsupported model: {model_name}")
    if response_format not in {"json", "text", "verbose_json"}:
        raise HTTPException(status_code=400, detail=f"Unsupported response_format: {response_format}")
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    try:
        audio = await asyncio.to_thread(load_uploaded_audio, audio_bytes, file.filename or "audio.wav")
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Failed to process audio: {error}") from error

    resolved_language = language or NEMOTRON_LANGUAGE
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
    current_item_id = item_id()
    previous_item_id: str | None = None
    try:
        queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=STT_STREAM_QUEUE_FRAMES)
        closed = asyncio.Event()
        _label(event="realtime_start", session=realtime_session_id, model=requested_model)

        async def reader() -> None:
            try:
                while not closed.is_set():
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    if message.get("bytes") is not None:
                        await websocket.send_json(
                            realtime_error("Binary WebSocket messages are not supported")
                        )
                    elif message.get("text") is not None:
                        await queue.put(message["text"])
            except WebSocketDisconnect:
                pass
            finally:
                await queue.put(None)

        async def worker() -> None:
            nonlocal transcription, effective_session, current_item_id, previous_item_id
            while not closed.is_set():
                payload = await queue.get()
                try:
                    if payload is None:
                        return
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
                            audio_bytes = base64.b64decode(encoded_audio, validate=True)
                            if not audio_bytes or len(audio_bytes) % 2:
                                raise ValueError("audio must contain PCM16 samples")
                            if len(audio_bytes) > 15 * 1024 * 1024:
                                raise ValueError("audio event exceeds the 15 MiB limit")
                        except (binascii.Error, ValueError) as decode_error:
                            await websocket.send_json(realtime_error(str(decode_error), client_event_id))
                            continue
                        text = await run_inference(
                            transcription.language,
                            transcription.append_and_decode,
                            audio_bytes,
                        )
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
                        _label(
                            event="realtime_final",
                            session=realtime_session_id,
                            audio_seconds=f"{audio_seconds:.1f}",
                            text_len=len(text),
                            elapsed=f"{time.time() - t0:.2f}s",
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
        _label(event="realtime_end", session=realtime_session_id)


if __name__ == "__main__":
    host = os.getenv("STT_HOST", "127.0.0.1")
    port = int(os.getenv("STT_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
