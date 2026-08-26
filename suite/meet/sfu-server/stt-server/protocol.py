import json
import re
import time
import uuid

MODEL_SAMPLE_RATE = 16000
REALTIME_SAMPLE_RATE = 24000


def clean_transcript(text: str) -> str:
    text = re.sub(r"\s*<[a-z]{2,3}(?:-[a-z0-9]{2,8})?>\s*", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def event_id() -> str:
    return f"event_{uuid.uuid4().hex}"


def item_id() -> str:
    return f"item_{uuid.uuid4().hex}"


def realtime_session(session_id: str, model: str, language: str) -> dict:
    return {
        "id": session_id,
        "object": "realtime.transcription_session",
        "type": "transcription",
        "expires_at": int(time.time()) + 3600,
        "audio": {
            "input": {
                "format": {"type": "audio/pcm", "rate": REALTIME_SAMPLE_RATE},
                "transcription": {"model": model, "language": language},
                "turn_detection": None,
            }
        },
        "include": [],
    }


def validate_session_update(
    message: dict,
    supported_models: set[str],
    default_model: str,
    default_language: str,
) -> tuple[dict | None, str | None]:
    session = message.get("session")
    if message.get("type") != "session.update" or not isinstance(session, dict):
        return None, "Expected a session.update event"
    if session.get("type") != "transcription":
        return None, "session.type must be transcription"
    audio = session.get("audio") or {}
    audio_input = audio.get("input") or {}
    audio_format = audio_input.get("format")
    if audio_format and (
        audio_format.get("type") != "audio/pcm" or audio_format.get("rate") != REALTIME_SAMPLE_RATE
    ):
        return None, f"Only {REALTIME_SAMPLE_RATE} Hz audio/pcm is supported"
    transcription = audio_input.get("transcription") or {}
    model = transcription.get("model") or default_model
    if model not in supported_models:
        return None, f"Unsupported transcription model: {model}"
    language = (
        transcription.get("language")
        or next(iter(transcription.get("languages") or []), None)
        or default_language
    )
    return {"model": model, "language": language}, None


def realtime_error(
    message: str, client_event_id: str | None = None, code: str = "invalid_request_error"
) -> dict:
    return {
        "event_id": event_id(),
        "type": "error",
        "error": {
            "type": "invalid_request_error",
            "code": code,
            "message": message,
            "param": None,
            "event_id": client_event_id,
        },
    }


def openai_sse_event(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def transcript_delta(previous: str, current: str) -> str | None:
    if current == previous:
        return None
    return current[len(previous) :] if current.startswith(previous) else None
