"""Build Writer and Sheet history without changing legacy rows."""

from suite.drive.patches.build.content_mapping import (
    MAX_VERSION_SEQ,
    InvalidLegacyContent,
    exact_fields,
    sheet_version_bytes,
    standard_fields,
)
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.ports import REMOVED


class BuildHistoryError(RuntimeError):
    """History cannot be copied without changing its meaning."""


VERSION_FIELDS = (
    "name",
    "node",
    "seq",
    "kind",
    "label",
    "pinned",
    "actor",
    "size",
    "blob",
    "owner",
    "creation",
    "modified",
    "modified_by",
)


def convert_history_and_comments(env, *, batch_size: int = BUILD_BATCH_SIZE, allow_deferred: bool = True):
    """Implement §14.2 step 7 and return the durable outcome."""
    _require_ticket27(env)
    source, target = _ports(env)
    content = env.state.content()
    content.history_completed = False
    content.history_existing_complete = False
    content.history_deferred = 0
    content.versions_seen = 0
    content.comments_seen = 0

    residual = source.residual_writer_versions(20)
    if residual:
        _fail(env, content, residual[0], "residual Writer Doc Version rows remain")

    pending = []
    for doctype in ("Writer Document", "Sheet"):
        after = ""
        while True:
            rows = source.documents(doctype, after, batch_size)
            if not rows:
                break
            for document in rows:
                node = _document_node(source, target, document)
                if node is None:
                    pending.append(document.name)
                    continue
                try:
                    if doctype == "Writer Document":
                        _writer_versions(env, content, document, node, batch_size)
                    else:
                        _sheet_versions(env, content, document, node, batch_size)
                    from suite.drive.patches.build.comments import convert_document_comments

                    content.comments_seen += convert_document_comments(
                        env, document, node, batch_size=batch_size
                    )
                except (InvalidLegacyContent, ValueError) as error:
                    _fail(env, content, f"{doctype}:{document.name}", str(error))
                env.state.put_content(content)
            after = rows[-1].name
            if len(rows) < batch_size:
                break

    content.history_deferred = len(pending)
    content.history_existing_complete = True
    if pending and not allow_deferred:
        _fail(env, content, pending[0], f"{len(pending)} content documents still have no node")
    content.history_completed = not pending
    if content.history_completed and not content.report_at:
        content.report_at = env.now()
    content.versions_to_thin = target.versions_to_thin(content.report_at) if content.report_at else 0
    content.completed = content.history_completed and content.slides_completed and content.links_completed
    env.state.put_content(content)
    return content


def _writer_versions(env, content, document, node: str, batch_size: int) -> None:
    rows = sorted(
        env.content.writer_versions(document.name), key=lambda row: (str(row.creation or ""), row.name)
    )
    expected = []
    target_batch = max(1, batch_size // 2)
    for seq, row in enumerate(rows, 1):
        raw = (row.snapshot or "").encode("utf-8")
        expected.append(
            _version_row(
                env,
                row,
                node=node,
                seq=seq,
                kind="named" if row.manual else "auto",
                label=row.title,
                pinned=0,
                actor=row.owner,
                raw=raw,
                filename=f"{row.name}.html",
            )
        )
        if len(expected) >= target_batch:
            _write_versions(env, content, node, expected, batch_size)
            expected = []
    _write_versions(env, content, node, expected, batch_size)


def _sheet_versions(env, content, document, node: str, batch_size: int) -> None:
    rows = env.content.sheet_snapshots(document.name)
    sequences = [int(row.seq) for row in rows]
    if any(seq < 1 or seq > MAX_VERSION_SEQ for seq in sequences):
        raise InvalidLegacyContent("Sheet Snapshot sequence does not fit the target positive Int")
    if len(sequences) != len(set(sequences)):
        raise InvalidLegacyContent("Sheet Snapshot sequences are not unique")
    expected = []
    by_name = {}
    target_batch = max(1, batch_size // 2)
    for row in rows:
        raw = sheet_version_bytes(row.sheets_data, row.seq)
        planned = _version_row(
            env,
            row,
            node=node,
            seq=int(row.seq),
            kind=row.kind,
            label=row.label,
            pinned=int(bool(row.pinned)),
            actor=row.actor,
            raw=raw,
            filename=f"{row.name}.json",
        )
        expected.append(planned)
        by_name[row.name] = planned
        if len(expected) >= target_batch:
            _write_versions(env, content, node, expected, batch_size)
            expected = []
    _write_versions(env, content, node, expected, batch_size)

    head = document.head_snapshot
    if head:
        source_head = next((row for row in rows if row.name == head), None)
        planned = by_name.get(head)
        stored = env.content_target.version_names((head,)).get(head)
        if not source_head or not planned or not stored:
            raise InvalidLegacyContent("Sheet head_snapshot does not name a migrated source snapshot")
        exact_fields(stored, planned, ("name", "node", "seq"), f"Sheet head {head}")


def _version_row(env, row, *, node, seq, kind, label, pinned, actor, raw, filename) -> dict:
    if kind not in ("auto", "named", "milestone"):
        raise InvalidLegacyContent(f"version {row.name} has invalid kind {kind!r}")
    if not actor:
        raise InvalidLegacyContent(f"version {row.name} has no actor")
    stored = env.content_target.version_names((row.name,)).get(row.name)
    if stored:
        blob = env.content_target.blob(stored.get("blob"))
        if not blob or blob.status != "Ready" or not blob.is_private or blob.file_size != len(raw):
            raise InvalidLegacyContent(f"version {row.name} has unavailable target bytes")
        if env.content_target.read_blob(blob.name) != raw:
            raise InvalidLegacyContent(f"version {row.name} target bytes differ from the source")
        blob_name = blob.name
    else:
        blob = env.content_target.put_private_blob(raw, filename)
        if not blob or blob.status != "Ready" or not blob.is_private or blob.file_size != len(raw):
            raise InvalidLegacyContent(f"version {row.name} blob write is incomplete")
        blob_name = blob.name
    return {
        "name": row.name,
        "node": node,
        "seq": seq,
        "kind": kind,
        "label": label,
        "pinned": pinned,
        "actor": actor,
        "size": len(raw),
        "blob": blob_name,
        **standard_fields(row),
    }


def _write_versions(env, content, node: str, expected: list[dict], batch_size: int) -> None:
    by_name = env.content_target.version_names(tuple(row["name"] for row in expected))
    by_seq = {int(row["seq"]): row for row in env.content_target.versions(node)}
    fresh = []
    # A new version can also create one File Blob in this transaction.
    target_batch = max(1, batch_size // 2)
    for planned in expected:
        content.versions_seen += 1
        stored = by_name.get(planned["name"])
        occupied = by_seq.get(planned["seq"])
        if stored:
            exact_fields(stored, planned, VERSION_FIELDS, f"version {planned['name']}")
            if occupied and occupied["name"] != planned["name"]:
                raise InvalidLegacyContent(f"version sequence {planned['seq']} is occupied")
            continue
        if occupied:
            raise InvalidLegacyContent(f"version sequence {planned['seq']} is occupied")
        fresh.append(planned)
        if len(fresh) >= target_batch:
            env.content_target.insert_versions(fresh)
            env.content_target.commit()
            env.state.put_content(content)
            fresh = []
    if fresh:
        env.content_target.insert_versions(fresh)
        env.content_target.commit()


def _document_node(source, target, document) -> str | None:
    if document.node:
        nodes = target.content_nodes(document.doctype, document.name)
        if len(nodes) != 1 or nodes[0]["name"] != document.node:
            raise InvalidLegacyContent(f"{document.doctype} {document.name} has a broken reciprocal link")
        return document.node
    files = source.files_for_content(document.doctype, document.name)
    if not files:
        nodes = target.content_nodes(document.doctype, document.name)
        if len(nodes) > 1:
            raise InvalidLegacyContent(f"{document.doctype} {document.name} has multiple target nodes")
        return nodes[0]["name"] if nodes else None
    if len(files) != 1:
        raise InvalidLegacyContent(f"{document.doctype} {document.name} has multiple legacy Files")
    file = files[0]
    if file.status == REMOVED:
        raise InvalidLegacyContent(f"legacy File {file.name} is Removed")
    nodes = target.nodes((file.name,))
    node = nodes.get(file.name)
    if not node or node.get("kind") != "document":
        raise InvalidLegacyContent(f"legacy File {file.name} has no document node")
    if (node.get("content_doctype"), node.get("content_docname")) != (document.doctype, document.name):
        raise InvalidLegacyContent(f"legacy File {file.name} targets another document")
    return file.name


def _ports(env):
    if env.content is None or env.content_target is None:
        raise RuntimeError("Build content ports are not configured")
    return env.content, env.content_target


def _require_ticket27(env):
    if not env.state.tree().completed or not env.state.grants().completed:
        raise BuildHistoryError("ticket 27 tree and grants must complete first")


def _fail(env, content, source: str, reason: str):
    content.record_issue(source, reason)
    env.state.put_content(content)
    raise BuildHistoryError(f"{source}: {reason}")
