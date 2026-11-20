"""Compact a checkpoint and the rows after it into one state, with pycrdt, and check the result.

pycrdt's bytes differ from run to run, so every check compares decoded
content, state vector and delete set, never bytes. A result whose state vector
falls short of the inputs is re-compacted once with the merge workaround; still
short, the merge of the inputs is kept as a base for opening only. Inputs
that wait on a change no row holds, or that split a surrogate pair, are left
uncompacted.
"""

import json
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import NamedTuple, cast

import pycrdt

from suite.content import updates
from suite.content.updates import Reader

PYCRDT_VERSION = "0.14.8"
CRDT_VERSION = f"pycrdt {PYCRDT_VERSION}"


class CompactionFailed(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class Compacted:
    state: bytes
    integrated: bool
    report: dict = field(default_factory=dict)
    # How long the job took, set by whoever ran it
    ms: int = 0


class Fingerprint(NamedTuple):
    content: str
    vector: dict
    deletes: dict


def compacted_state(merged: bytes, parts: list[bytes], wanted_vector: dict) -> tuple[bytes, bool]:
    """Compact `parts`, merging in once what pycrdt leaves out of `merged`; true when it fell short."""
    doc = load_doc(parts)
    state = doc.get_update()
    reached_vector = state_vector(pycrdt.get_state(state))
    if reached_vector == wanted_vector:
        return state, False

    missing = pycrdt.get_update(merged, doc.get_state())
    return pycrdt.merge_updates(state, missing), True


def require_same_content(
    state: bytes,
    parts: list[bytes],
    expected_fingerprint: Fingerprint,
    part_map: Mapping[str, type],
) -> None:
    """Raise `CompactionFailed` unless `state`, reloaded, re-encoded and given every part, still matches."""
    reloaded = load_doc([state])
    if fingerprint(reloaded, part_map) != expected_fingerprint:
        raise CompactionFailed("content_mismatch")

    if fingerprint(load_doc([reloaded.get_update()]), part_map) != expected_fingerprint:
        raise CompactionFailed("reencode_mismatch")

    for part in parts:
        reloaded.apply_update(part)

    if vector_and_deletes(reloaded) != (expected_fingerprint.vector, expected_fingerprint.deletes):
        raise CompactionFailed("not_contained")


def checked_compaction(parts: list[bytes], row_count: int, part_map: Mapping[str, type]) -> Compacted:
    """Compact `parts` and check the result, keeping their merge for opening when pycrdt falls short."""
    merged = pycrdt.merge_updates(*parts)
    merged_state = pycrdt.get_state(merged)
    # Structs past the state vector wait on a change no row holds yet
    past_state = pycrdt.get_update(merged, merged_state)
    if Reader(past_state).uint():
        raise CompactionFailed("missing_dependency")

    wanted_vector = state_vector(merged_state)
    state, is_short = compacted_state(merged, parts, wanted_vector)
    report = {"rows": row_count}
    if is_short:
        report["short"] = True

    reached_vector = state_vector(pycrdt.get_state(state))
    if reached_vector != wanted_vector:
        report["fallback"] = True
        return Compacted(merged, integrated=False, report=report)

    expected_fingerprint = fingerprint(load_doc([merged]), part_map)
    require_same_content(state, parts, expected_fingerprint, part_map)
    report["clients"] = len(expected_fingerprint.vector)
    return Compacted(state, integrated=True, report=report)


def compact(checkpoint: bytes | None, rows: list[bytes], part_map: Mapping[str, type]) -> Compacted:
    """`part_map` names every root type the product writes; a document with another root is refused."""
    if pycrdt.__version__ != PYCRDT_VERSION:
        raise CompactionFailed("kernel_version")

    checkpoint_part: list[bytes] = []
    if checkpoint:
        checkpoint_part = [checkpoint]

    parts = checkpoint_part + list(rows)
    unfit_part = first_unfit_part(parts)
    if unfit_part:
        raise CompactionFailed(unfit_part[1])

    try:
        return checked_compaction(parts, len(rows), part_map)
    except CompactionFailed:
        raise
    # pycrdt panics derive from BaseException
    except BaseException as error:
        if isinstance(error, KeyboardInterrupt | SystemExit):
            raise

        raise CompactionFailed("unreadable") from error


def first_unfit_part(parts: list[bytes]) -> tuple[int, str] | None:
    """Find the first part that can't be read or splits a surrogate pair, which Yjs and yrs read apart."""
    pairs: set[tuple[int, int]] = set()
    for index, part in enumerate(parts):
        try:
            update = updates.parse(part)
        except ValueError:
            return index, "malformed_row"

        for struct in update.structs:
            pairs.update((struct.client, clock) for clock in struct.pairs)

        if update.split_points() & pairs:
            return index, "cut_surrogate"

    return None


def same_content(left: bytes, right: bytes, part_map: Mapping[str, type]) -> bool:
    """Whether two states hold the same content, state vector and delete set."""
    return fingerprint(load_doc([left]), part_map) == fingerprint(load_doc([right]), part_map)


def load_doc(parts: list[bytes]) -> pycrdt.Doc:
    """Load a pycrdt document from `parts`, applied in order."""
    doc: pycrdt.Doc = pycrdt.Doc()
    for part in parts:
        doc.apply_update(part)

    return doc


def fingerprint(doc: pycrdt.Doc, part_map: Mapping[str, type]) -> Fingerprint:
    """Return the document's content, state vector and delete set, to compare states by."""
    content = content_json(doc, part_map)
    vector, deletes = vector_and_deletes(doc)
    return Fingerprint(content, vector, deletes)


def content_json(
    doc: pycrdt.Doc, part_map: Mapping[str, type], rewrite: Callable[[str], str] | None = None
) -> str:
    """Write the document as JSON; `rewrite` is applied to its values, never its text, tags or keys."""
    unknown = set(doc.keys()) - set(part_map)
    if unknown:
        raise CompactionFailed("unknown_root")

    by_root = {name: serialize(doc.get(name, type=kind), rewrite) for name, kind in sorted(part_map.items())}
    return json.dumps(by_root, ensure_ascii=False)


def merged_ranges(ranges: list[tuple[int, int]]) -> list[list[int]]:
    """Merge sorted delete ranges that touch or overlap, dropping empty ones."""
    merged: list[list[int]] = []
    for start, length in ranges:
        if length and merged and start <= merged[-1][0] + merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], start + length - merged[-1][0])
        elif length:
            merged.append([start, length])

    return merged


def vector_and_deletes(doc: pycrdt.Doc) -> tuple[dict, dict]:
    """Read the state vector and the merged delete set from pycrdt's snapshot encoding."""
    encoded = pycrdt.Snapshot.from_doc(doc).encode()
    reader = Reader(encoded)
    delete_set: dict[int, list[tuple[int, ...]]] = {}
    for _ in range(reader.uint()):
        client = reader.uint()
        ranges = sorted((reader.uint(), reader.uint()) for _ in range(reader.uint()))
        merged = merged_ranges(ranges)
        if merged:
            delete_set[client] = [tuple(span) for span in merged]

    return read_clocks(reader), delete_set


def state_vector(encoded: bytes) -> dict:
    """Read an encoded state vector."""
    return read_clocks(Reader(encoded))


def read_clocks(reader: Reader) -> dict:
    """Read each client's clock, leaving out clients at zero."""
    found: dict[int, int] = {}
    for _ in range(reader.uint()):
        client = reader.uint()
        clock = reader.uint()
        if clock:
            found[client] = clock

    return found


def serialize(value: object, rewrite: Callable[[str], str] | None = None) -> object:
    """Turn a shared type into plain JSON values, with `rewrite` applied to its values."""
    if isinstance(value, pycrdt.XmlText):
        serialized: dict[str, object] = {"text": text_delta(value.diff(), rewrite)}
        attributes = attributes_of(value)
        if attributes:
            serialized["attrs"] = plain_value(attributes, rewrite)

        return serialized

    if isinstance(value, pycrdt.XmlElement):
        return {
            "el": value.tag,
            "attrs": plain_value(attributes_of(value), rewrite),
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


def attributes_of(node: pycrdt.XmlText | pycrdt.XmlElement) -> dict[str, object]:
    """Read a node's attributes; pycrdt's view yields its pairs but isn't typed as iterable."""
    return dict(cast("Iterable[tuple[str, object]]", node.attributes))


def text_delta(diff: list[tuple[object, dict | None]], rewrite: Callable[[str], str] | None = None) -> list:
    """Turn a text diff into plain insert ops, joining runs of text with the same attributes."""
    ops: list[dict] = []
    for insert, attributes in diff:
        item = insert
        if not isinstance(insert, str):
            item = plain_value(insert, rewrite)

        plain_attributes = None
        if attributes:
            plain_attributes = plain_value(dict(attributes), rewrite)

        last_is_same_text = (
            bool(ops) and isinstance(ops[-1]["insert"], str) and ops[-1].get("attributes") == plain_attributes
        )
        if isinstance(item, str) and last_is_same_text:
            ops[-1]["insert"] += item
            continue

        entry = {"insert": item}
        if plain_attributes:
            entry["attributes"] = plain_attributes

        ops.append(entry)

    return ops


def plain_value(value: object, rewrite: Callable[[str], str] | None = None) -> object:
    """Turn a value into plain JSON, with `rewrite` applied to its strings."""
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
