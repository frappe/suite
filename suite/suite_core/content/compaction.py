"""Compact a checkpoint and the rows after it into one state, with pycrdt, and check the result.

pycrdt's bytes differ from run to run, so every check compares decoded
content, state vector and delete set, never bytes. A result whose state vector
falls short of the inputs is re-compacted once with the merge workaround; still
short, the merge of the inputs is kept as a base for opening only. Inputs
that wait on a change no row holds, or that split a surrogate pair, are left
uncompacted.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field

import pycrdt

from suite.suite_core.content import updates
from suite.suite_core.content.updates import Reader

PYCRDT_VERSION = "0.14.8"
KERNEL = f"pycrdt {PYCRDT_VERSION}"


class CompactionFailed(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class Compacted:
    state: bytes
    integrated: bool
    report: dict = field(default_factory=dict)
    # How long the job took, set by whoever ran it
    ms: int = 0


def compact(checkpoint: bytes | None, rows: list[bytes], roots: Mapping[str, type]) -> Compacted:
    """`roots` names every root type the product writes; a document with another root is refused."""
    if pycrdt.__version__ != PYCRDT_VERSION:
        raise CompactionFailed("kernel_version")

    checkpoint_part = [checkpoint] if checkpoint else []
    parts = checkpoint_part + list(rows)
    unfit_part = first_unfit_part(parts)
    if unfit_part:
        raise CompactionFailed(unfit_part[1])

    try:
        merged = pycrdt.merge_updates(*parts)
        merged_state = pycrdt.get_state(merged)
        # Structs past the state vector wait on a change no row holds yet
        past_state = pycrdt.get_update(merged, merged_state)
        if Reader(past_state).uint():
            raise CompactionFailed("missing_dependency")

        wanted_vector = state_vector(merged_state)
        doc = load_doc(parts)
        state = doc.get_update()
        report = {"rows": len(rows)}
        reached_vector = state_vector(pycrdt.get_state(state))
        if reached_vector != wanted_vector:
            report["short"] = True
            missing = pycrdt.get_update(merged, doc.get_state())
            state = pycrdt.merge_updates(state, missing)
        del doc
        reached_vector = state_vector(pycrdt.get_state(state))
        if reached_vector != wanted_vector:
            report["fallback"] = True
            return Compacted(merged, integrated=False, report=report)

        expected_fingerprint = fingerprint(load_doc([merged]), roots)
        reloaded = load_doc([state])
        if fingerprint(reloaded, roots) != expected_fingerprint:
            raise CompactionFailed("content_mismatch")

        if fingerprint(load_doc([reloaded.get_update()]), roots) != expected_fingerprint:
            raise CompactionFailed("reencode_mismatch")

        for part in parts:
            reloaded.apply_update(part)
        if vector_and_deletes(reloaded) != expected_fingerprint[1:]:
            raise CompactionFailed("not_contained")
    except CompactionFailed:
        raise
    except BaseException as error:  # pycrdt panics derive from BaseException
        if isinstance(error, KeyboardInterrupt | SystemExit):
            raise
        raise CompactionFailed("unreadable") from error

    report["clients"] = len(expected_fingerprint[1])
    return Compacted(state, integrated=True, report=report)


def first_unfit_part(parts: list[bytes]) -> tuple[int, str] | None:
    """The index of the first part that can't be read or that splits an emoji, or any surrogate pair,
    between its two halves, with the reason; None when every part is fit.

    Yjs turns both halves of a split pair into replacement characters and yrs does
    not, so the compaction would no longer match what browsers hold.
    """
    pairs: set[tuple[int, int]] = set()
    for index, part in enumerate(parts):
        try:
            update = updates.parse(part)
        except ValueError:
            return index, "malformed_row"

        pairs.update((struct.client, clock) for struct in update.structs for clock in struct.pairs)
        if update.split_points() & pairs:
            return index, "cut_surrogate"

    return None


def same_content(left: bytes, right: bytes, roots: Mapping[str, type]) -> bool:
    """Whether two states hold the same content, state vector and delete set."""
    return fingerprint(load_doc([left]), roots) == fingerprint(load_doc([right]), roots)


def load_doc(parts: list[bytes]) -> pycrdt.Doc:
    doc: pycrdt.Doc = pycrdt.Doc()
    for part in parts:
        doc.apply_update(part)

    return doc


def fingerprint(doc: pycrdt.Doc, roots: Mapping[str, type]) -> tuple[str, dict, dict]:
    return (content_json(doc, roots), *vector_and_deletes(doc))


def content_json(doc: pycrdt.Doc, roots: Mapping[str, type], rewrite=None) -> str:
    """The document as JSON; `rewrite` is applied to its values, never its text, tags or keys."""
    unknown = set(doc.keys()) - set(roots)
    if unknown:
        raise CompactionFailed("unknown_root")

    by_root = {name: serialize(doc.get(name, type=kind), rewrite) for name, kind in sorted(roots.items())}
    return json.dumps(by_root, ensure_ascii=False)


def vector_and_deletes(doc: pycrdt.Doc) -> tuple[dict, dict]:
    """The state vector and the merged delete set, read from pycrdt's snapshot encoding."""
    encoded = pycrdt.Snapshot.from_doc(doc).encode()
    reader = Reader(encoded)
    delete_set = {}
    for _ in range(reader.uint()):
        client = reader.uint()
        merged: list[list[int]] = []
        ranges = sorted((reader.uint(), reader.uint()) for _ in range(reader.uint()))
        for start, length in ranges:
            if length and merged and start <= merged[-1][0] + merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], start + length - merged[-1][0])
            elif length:
                merged.append([start, length])
        if merged:
            delete_set[client] = [tuple(span) for span in merged]

    return read_clocks(reader), delete_set


def state_vector(encoded: bytes) -> dict:
    return read_clocks(Reader(encoded))


def read_clocks(reader: Reader) -> dict:
    found = {}
    for _ in range(reader.uint()):
        client, clock = reader.uint(), reader.uint()
        if clock:
            found[client] = clock

    return found


def serialize(value, rewrite=None):
    if isinstance(value, pycrdt.XmlText):
        serialized = {"text": text_delta(value.diff(), rewrite)}
        if attributes := dict(value.attributes):
            serialized["attrs"] = plain_value(attributes, rewrite)

        return serialized

    if isinstance(value, pycrdt.XmlElement):
        return {
            "el": value.tag,
            "attrs": plain_value(dict(value.attributes), rewrite),
            "kids": [serialize(child, rewrite) for child in value.children],
        }

    if isinstance(value, pycrdt.XmlFragment):
        return {"frag": [serialize(child, rewrite) for child in value.children]}

    if isinstance(value, pycrdt.Text):
        return {"ytext": text_delta(value.diff(), rewrite)}

    if isinstance(value, pycrdt.Map):
        return {"map": {key: serialize(value[key], rewrite) for key in sorted(value.keys())}}

    if isinstance(value, pycrdt.Array):
        return {"arr": [serialize(item, rewrite) for item in value]}

    return plain_value(value, rewrite)


def text_delta(diff, rewrite=None) -> list:
    ops: list[dict] = []
    for insert, attributes in diff:
        item = insert if isinstance(insert, str) else plain_value(insert, rewrite)
        attributes = plain_value(dict(attributes), rewrite) if attributes else None
        last_is_same_text = (
            bool(ops) and isinstance(ops[-1]["insert"], str) and ops[-1].get("attributes") == attributes
        )
        if isinstance(item, str) and last_is_same_text:
            ops[-1]["insert"] += item
            continue

        entry = {"insert": item}
        if attributes:
            entry["attributes"] = attributes
        ops.append(entry)

    return ops


def plain_value(value, rewrite=None):
    if isinstance(
        value,
        pycrdt.Map | pycrdt.Array | pycrdt.Text | pycrdt.XmlFragment | pycrdt.XmlElement | pycrdt.XmlText,
    ):
        return serialize(value, rewrite)

    if isinstance(value, str) and rewrite:
        return rewrite(value)

    if isinstance(value, list | tuple):
        return [plain_value(item, rewrite) for item in value]

    if isinstance(value, bytes | bytearray):
        return {"$bin": bytes(value).hex()}

    if isinstance(value, dict):
        return {key: plain_value(value[key], rewrite) for key in sorted(value)}

    if isinstance(value, float) and value.is_integer():
        return int(value)

    return value
