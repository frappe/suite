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

from suite.suite_core.collab import updates
from suite.suite_core.collab.updates import Reader

PYCRDT = "0.14.8"
KERNEL = f"pycrdt {PYCRDT}"


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
    if pycrdt.__version__ != PYCRDT:
        raise CompactionFailed("kernel_version")
    parts = ([checkpoint] if checkpoint else []) + list(rows)
    found = unfit(parts)
    if found:
        raise CompactionFailed(found[1])
    try:
        merged = pycrdt.merge_updates(*parts)
        merged_state = pycrdt.get_state(merged)
        # Structs past the state vector wait on a change no row holds yet
        if Reader(pycrdt.get_update(merged, merged_state)).uint():
            raise CompactionFailed("missing_dependency")
        wanted = state_vector(merged_state)
        doc = load(parts)
        state = doc.get_update()
        report = {"rows": len(rows)}
        if state_vector(pycrdt.get_state(state)) != wanted:
            report["short"] = True
            state = pycrdt.merge_updates(state, pycrdt.get_update(merged, doc.get_state()))
        del doc
        if state_vector(pycrdt.get_state(state)) != wanted:
            report["fallback"] = True
            return Compacted(merged, integrated=False, report=report)

        expected = fingerprint(load([merged]), roots)
        reloaded = load([state])
        if fingerprint(reloaded, roots) != expected:
            raise CompactionFailed("content_mismatch")
        if fingerprint(load([reloaded.get_update()]), roots) != expected:
            raise CompactionFailed("reencode_mismatch")
        for part in parts:
            reloaded.apply_update(part)
        if snapshot(reloaded) != expected[1:]:
            raise CompactionFailed("not_contained")
    except CompactionFailed:
        raise
    except BaseException as error:  # pycrdt panics derive from BaseException
        if isinstance(error, KeyboardInterrupt | SystemExit):
            raise
        raise CompactionFailed("unreadable") from error
    report["clients"] = len(expected[1])
    return Compacted(state, integrated=True, report=report)


def unfit(parts: list[bytes]) -> tuple[int, str] | None:
    """The index of the first part that can't be read or that splits an emoji, or any surrogate pair,
    between its two halves, with the reason; None when every part is fit.

    Yjs turns both halves of a split pair into replacement characters and yrs does
    not, so the compaction would no longer match what browsers hold.
    """
    pairs = set()
    for index, part in enumerate(parts):
        try:
            update = updates.parse(part)
        except ValueError:
            return index, "malformed_row"
        pairs.update((struct.client, clock) for struct in update.structs for clock in struct.pairs)
        if update.split_points() & pairs:
            return index, "cut_surrogate"
    return None


def same(left: bytes, right: bytes, roots: Mapping[str, type]) -> bool:
    """Whether two states hold the same content, state vector and delete set."""
    return fingerprint(load([left]), roots) == fingerprint(load([right]), roots)


def load(parts: list[bytes]) -> pycrdt.Doc:
    doc = pycrdt.Doc()
    for part in parts:
        doc.apply_update(part)
    return doc


def fingerprint(doc: pycrdt.Doc, roots: Mapping[str, type]) -> tuple[str, dict, dict]:
    return (content(doc, roots), *snapshot(doc))


def content(doc: pycrdt.Doc, roots: Mapping[str, type], rewrite=None) -> str:
    """The document as JSON; `rewrite` is applied to its values, never its text, tags or keys."""
    unknown = set(doc.keys()) - set(roots)
    if unknown:
        raise CompactionFailed("unknown_root")
    return json.dumps(
        {name: serialize(doc.get(name, type=kind), rewrite) for name, kind in sorted(roots.items())},
        ensure_ascii=False,
    )


def snapshot(doc: pycrdt.Doc) -> tuple[dict, dict]:
    """The state vector and the merged delete set, read from pycrdt's snapshot encoding."""
    reader = Reader(pycrdt.Snapshot.from_doc(doc).encode())
    deleted = {}
    for _ in range(reader.uint()):
        client = reader.uint()
        merged = []
        for start, length in sorted((reader.uint(), reader.uint()) for _ in range(reader.uint())):
            if length and merged and start <= merged[-1][0] + merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], start + length - merged[-1][0])
            elif length:
                merged.append([start, length])
        if merged:
            deleted[client] = [tuple(r) for r in merged]
    return clocks(reader), deleted


def state_vector(encoded: bytes) -> dict:
    return clocks(Reader(encoded))


def clocks(reader: Reader) -> dict:
    found = {}
    for _ in range(reader.uint()):
        client, clock = reader.uint(), reader.uint()
        if clock:
            found[client] = clock
    return found


def serialize(value, rewrite=None):
    if isinstance(value, pycrdt.XmlText):
        out = {"text": delta(value.diff(), rewrite)}
        if attributes := dict(value.attributes):
            out["attrs"] = plain(attributes, rewrite)
        return out
    if isinstance(value, pycrdt.XmlElement):
        return {
            "el": value.tag,
            "attrs": plain(dict(value.attributes), rewrite),
            "kids": [serialize(c, rewrite) for c in value.children],
        }
    if isinstance(value, pycrdt.XmlFragment):
        return {"frag": [serialize(child, rewrite) for child in value.children]}
    if isinstance(value, pycrdt.Text):
        return {"ytext": delta(value.diff(), rewrite)}
    if isinstance(value, pycrdt.Map):
        return {"map": {key: serialize(value[key], rewrite) for key in sorted(value.keys())}}
    if isinstance(value, pycrdt.Array):
        return {"arr": [serialize(item, rewrite) for item in value]}
    return plain(value, rewrite)


def delta(diff, rewrite=None) -> list:
    out = []
    for insert, attributes in diff:
        item = insert if isinstance(insert, str) else plain(insert, rewrite)
        attributes = plain(dict(attributes), rewrite) if attributes else None
        if (
            isinstance(item, str)
            and out
            and isinstance(out[-1]["insert"], str)
            and out[-1].get("attributes") == attributes
        ):
            out[-1]["insert"] += item
            continue
        out.append({"insert": item, **({"attributes": attributes} if attributes else {})})
    return out


def plain(value, rewrite=None):
    if isinstance(
        value,
        pycrdt.Map | pycrdt.Array | pycrdt.Text | pycrdt.XmlFragment | pycrdt.XmlElement | pycrdt.XmlText,
    ):
        return serialize(value, rewrite)
    if isinstance(value, str) and rewrite:
        return rewrite(value)
    if isinstance(value, list | tuple):
        return [plain(item, rewrite) for item in value]
    if isinstance(value, bytes | bytearray):
        return {"$bin": bytes(value).hex()}
    if isinstance(value, dict):
        return {key: plain(value[key], rewrite) for key in sorted(value)}
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value
