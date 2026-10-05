"""Writer's collaborative documents, kept in the collab library's update log."""

import base64
import gzip
import json

import pycrdt

from suite.suite_core import collab
from suite.suite_core.collab import checkpoints, compaction, scheduling, updates

ADAPTER = "writer"
# The editor's fragment, and tab labels
ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}


def ensure_tables() -> None:
    collab.ensure_tables(ADAPTER)


def start_log(node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if collab.enabled():
        collab.create(ADAPTER, node)


def live_state(node: str) -> pycrdt.Doc | None:
    """The document as its log stands now, read in the caller's transaction; None when the node has no log."""
    doc = collab.find(ADAPTER, node)
    if not doc:
        return None
    read = collab.read(ADAPTER, doc.id, own_snapshot=False)
    parts = ([read["checkpoint"]] if read["checkpoint"] else []) + [payload for _rev, payload in read["rows"]]
    return compaction.load(parts)


def version_payload(node: str) -> dict | None:
    """The document now as a `writer-document/2` version, or None while its body is not in a log.

    The state is compacted with pycrdt in the request from the newest integrated
    checkpoint, never a fallback one, and only an integrated result is answered.
    The readable copy is not built yet, so `html` is null.
    """
    if not collab.enabled():
        return None
    doc = collab.find(ADAPTER, node)
    if not doc:
        return None
    read = collab.read(ADAPTER, doc.id, integrated=True, own_snapshot=False)
    rows = [payload for _rev, payload in read["rows"]]
    if rows:
        result = compaction.compact(read["checkpoint"], rows, ROOTS)
        if not result.integrated:
            raise compaction.CompactionFailed("fallback")
        state = result.state
    else:
        state = read["checkpoint"] or pycrdt.Doc().get_update()
    return {
        "schema": "writer-document/2",
        "codec": "yjs1",
        "lineage": read["lineage"],
        "through_rev": read["head_rev"],
        "chain": read["head_chain"].hex(),
        "state": base64.b64encode(gzip.compress(state)).decode("ascii"),
        "html": None,
    }


def copy_log(source_node: str, node: str) -> bool:
    """Start `node`'s log from `source_node`'s state now, under a new lineage; False while the source is not in a log."""
    payload = version_payload(source_node)
    if payload is None:
        return False
    collab.create(ADAPTER, node, state=gzip.decompress(base64.b64decode(payload["state"])))
    return True


def remap_log(node: str, rewrite) -> None:
    """Rewrite the values a copied log starts from, in place: no struct, row or session is added.

    The result must hold the same structs, read as the copy with `rewrite` applied to every
    attribute, mark and embed value, and give nothing more to rewrite.
    """
    doc = collab.find(ADAPTER, node)
    read = collab.read(ADAPTER, doc.id, own_snapshot=False)
    state = read["checkpoint"]
    remapped = updates.rewrite_values(state, rewrite)
    if remapped == state:
        return
    before, after = compaction.load([state]), compaction.load([remapped])
    expected = rewritten_view(compaction.content(before, ROOTS), rewrite)
    if (
        compaction.snapshot(after) != compaction.snapshot(before)
        or compaction.content(after, ROOTS) != expected
        or updates.rewrite_values(remapped, rewrite) != remapped
    ):
        raise compaction.CompactionFailed("remap_mismatch")
    collab.replace_start(ADAPTER, doc.id, remapped)


def rewritten_view(content: str, rewrite) -> str:
    """`compaction.content` of a document with `rewrite` applied to its values, never its text, tags or keys."""

    def value(item):
        if isinstance(item, str):
            return rewrite(item)
        if isinstance(item, list):
            return [value(entry) for entry in item]
        if isinstance(item, dict):
            return {key: value(entry) for key, entry in item.items()}
        return item

    def node(item):
        if isinstance(item, dict) and "text" in item:
            return {
                **item,
                **({"attrs": value(item["attrs"])} if "attrs" in item else {}),
                "text": [
                    {
                        "insert": op["insert"] if isinstance(op["insert"], str) else value(op["insert"]),
                        **({"attributes": value(op["attributes"])} if "attributes" in op else {}),
                    }
                    for op in item["text"]
                ],
            }
        if isinstance(item, dict) and "el" in item:
            return {
                "el": item["el"],
                "attrs": value(item["attrs"]),
                "kids": [node(kid) for kid in item["kids"]],
            }
        if isinstance(item, dict) and "frag" in item:
            return {"frag": [node(kid) for kid in item["frag"]]}
        if isinstance(item, dict) and "map" in item:
            return {"map": {key: node(entry) for key, entry in item["map"].items()}}
        return value(item)

    return json.dumps({name: node(root) for name, root in json.loads(content).items()}, ensure_ascii=False)


def compact(doc_id: str) -> None:
    checkpoints.run(ADAPTER, doc_id, ROOTS)


def consider_compaction(doc_id: str, *, final_from: str | None = None) -> None:
    scheduling.consider(ADAPTER, doc_id, "suite.writer.collab.compact", final_from=final_from)


def sweep() -> None:
    scheduling.sweep(ADAPTER, "suite.writer.collab.compact")
