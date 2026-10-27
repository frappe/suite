"""Immutable product vocabulary and bounded automatic metadata; no model or site state."""

import json
import unicodedata
from pathlib import Path

_VOCABULARY = json.loads(Path(__file__).with_name("speech-vocabulary.json").read_text())
CURRENT_VERSION = _VOCABULARY["current"]
LEGACY_VERSION = "frappe-v1"
MAX_NAMES = 20
MAX_NAME_LENGTH = 80
MAX_PARTICIPANTS = 100
MAX_TITLE_LENGTH = 160


def vocabulary(version):
    if not isinstance(version, str) or version not in _VOCABULARY["versions"]:
        raise ValueError("unsupported_vocabulary_version")
    return tuple(_VOCABULARY["versions"][version])


def label(value, maximum):
    if not isinstance(value, str):
        raise ValueError("invalid_speech_hint")
    value = unicodedata.normalize("NFKC", value).strip()
    if (
        not value
        or len(value) > maximum
        or "<|" in value
        or "|>" in value
        or any(unicodedata.category(c)[0] == "C" for c in value)
    ):
        raise ValueError("invalid_speech_hint")
    return value


def validate_names(names, *, maximum=MAX_NAMES):
    if not isinstance(names, list) or len(names) > maximum:
        raise ValueError("invalid_speech_hint_names")
    result = []
    seen = set()
    for value in names:
        name = label(value, MAX_NAME_LENGTH)
        key = name.casefold()
        if key not in seen:
            seen.add(key)
            result.append(name)
    return result


def make_hints(title, names, version=CURRENT_VERSION):
    vocabulary(version)
    # Automatic metadata must never prevent capture because a display label is
    # unsuitable for hints. It still remains unchanged in attribution metadata.
    clean_names = []
    seen = set()
    for name in names:
        try:
            name = label(name, MAX_NAME_LENGTH)
        except ValueError:
            continue
        if name.casefold() not in seen:
            clean_names.append(name)
            seen.add(name.casefold())
        if len(clean_names) == MAX_PARTICIPANTS:
            break
    try:
        title = label(title, MAX_TITLE_LENGTH)
    except ValueError:
        title = ""
    return {"vocabulary_version": version, "title": title, "participant_names": clean_names}


def validate_hints(value):
    if not isinstance(value, dict) or set(value) != {"vocabulary_version", "title", "participant_names"}:
        raise ValueError("invalid_speech_hints")
    vocabulary(value["vocabulary_version"])
    title = label(value["title"], MAX_TITLE_LENGTH) if value["title"] else ""
    names = validate_names(value["participant_names"], maximum=MAX_PARTICIPANTS)
    canonical = {
        "vocabulary_version": value["vocabulary_version"],
        "title": title,
        "participant_names": names,
    }
    if canonical != value:
        raise ValueError("noncanonical_speech_hints")
    return canonical


def hint_phrases(hints, speaker_name=""):
    hints = validate_hints(hints)
    # Round-robin categories so a tokenizer budget cannot exclude all domain
    # terms just because a room has many participants. Never rewrite output text.
    names = list(hints["participant_names"])
    try:
        speaker_name = label(speaker_name, MAX_NAME_LENGTH)
        names = [speaker_name, *(n for n in names if n.casefold() != speaker_name.casefold())]
    except ValueError:
        pass
    groups = [
        names,
        [hints["title"]] if hints["title"] else [],
        list(vocabulary(hints["vocabulary_version"])),
    ]
    phrases = []
    seen = set()
    for i in range(max(map(len, groups))):
        for group in groups:
            if i < len(group) and group[i].casefold() not in seen:
                phrases.append(group[i])
                seen.add(group[i].casefold())
    return tuple(phrases)
