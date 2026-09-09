"""Build Writer and Sheet history without changing legacy rows."""

from suite.drive.patches.build.content_mapping import (
    MAX_VERSION_SEQ,
    InvalidLegacyContent,
    RemovedLegacyFile,
    exact_fields,
    sheet_version_bytes,
    standard_fields,
)
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.ports import REMOVED


class BuildHistoryError(RuntimeError):
    """History cannot be copied without changing its meaning."""


# The counters this phase owns. Every other value in `ContentConversion`
# belongs to the links or slides phase and must survive a history rerun.
HISTORY_FIELDS = (
    "history_completed",
    "history_existing_complete",
    "history_deferred",
    "versions_seen",
    "comments_seen",
)

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
    # The census the last complete pass froze its `report_at` against. New
    # source history has to invalidate that timestamp (plan §8), and the source
    # version count is what says whether any arrived.
    #
    # `history_completed` is what makes the stored count comparable. A pass that
    # died partway leaves a partial `versions_seen` beside the earlier pass's
    # `report_at`, because the record is written per document. Comparing that
    # partial count would read "new history arrived", re-mint `report_at` to
    # today, and sweep every version live users wrote since the frozen census
    # into the thinning count.
    counted = content.versions_seen if content.report_at and content.history_completed else None
    content.begin_phase("history", HISTORY_FIELDS)

    residual = source.residual_writer_versions(1)
    if residual:
        _fail(env, content, residual[0], "residual Writer Doc Version rows remain")

    # Plan §4: leave true orphan history pending without storing an unbounded
    # id list. One id is the bounded evidence; the count is exact.
    deferred = 0
    first_pending = ""
    for doctype in ("Writer Document", "Sheet"):
        after = ""
        while True:
            rows = source.documents(doctype, after, batch_size)
            if not rows:
                break
            for document in rows:
                # `_document_node` refuses a broken or multiply claimed File,
                # and that refusal owes the same bounded evidence as any other:
                # it fails completion, it does not crash the run with a bare
                # exception and an unwritten state file.
                try:
                    node = _document_node(source, target, document)
                    if node is None:
                        deferred += 1
                        first_pending = first_pending or document.name
                    else:
                        if doctype == "Writer Document":
                            _writer_versions(env, content, document, node, batch_size)
                        else:
                            _sheet_versions(env, content, document, node, batch_size)
                        from suite.drive.patches.build.comments import convert_document_comments

                        content.comments_seen += convert_document_comments(
                            env, content, document, node, batch_size=batch_size
                        )
                except RemovedLegacyFile:
                    # No node, and none is coming: §14.4 skipped the File row.
                    # Not deferred, so the phase can still complete, and not
                    # counted here, because step 10 walks all three content
                    # doctypes and owns the one census.
                    pass
                except (InvalidLegacyContent, ValueError) as error:
                    _fail(env, content, f"{doctype}:{document.name}", str(error))
                env.state.put_content(content)
            after = rows[-1].name
            if len(rows) < batch_size:
                break

    content.history_deferred = deferred
    content.history_existing_complete = True
    if deferred and not allow_deferred:
        _fail(env, content, first_pending, f"{deferred} content documents still have no node")
    content.history_completed = not deferred
    if content.history_completed:
        # Only now. Every document that owns a legacy `Drive Comment` row has
        # had its Yjs entries written, so what is still legacy is a row no
        # Yjs entry claims. Run it while documents are deferred and a later
        # pass would meet a thread it did not write.
        from suite.drive.patches.build.comments import port_legacy_comments

        try:
            port_legacy_comments(env, content, batch_size=batch_size)
        except InvalidLegacyContent as error:
            _fail(env, content, "Drive Comment", str(error))
        if counted is not None and counted != content.versions_seen:
            content.report_at = None
        if not content.report_at:
            content.report_at = env.now()
    content.versions_to_thin = target.versions_to_thin(content.report_at) if content.report_at else 0
    content.completed = content.history_completed and content.slides_completed and content.links_completed
    env.state.put_content(content)
    return content


def _writer_versions(env, content, document, node: str, batch_size: int) -> None:
    # The source page is the keyset the port orders by, so the running index is
    # the target `seq`: position 1 is the oldest `(creation, name)`.
    expected = []
    target_batch = max(1, batch_size // 2)
    by_seq = env.content_target.version_seqs(node)
    after = ("", "")
    seq = 0
    while True:
        rows = env.content.writer_versions(document.name, after, target_batch)
        if not rows:
            break
        for row in rows:
            seq += 1
            if seq > MAX_VERSION_SEQ:
                raise InvalidLegacyContent("Writer Version count does not fit the target positive Int")
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
                _write_versions(env, content, node, expected, by_seq, batch_size)
                expected = []
        after = (str(rows[-1].creation or ""), rows[-1].name)
        if len(rows) < target_batch:
            break
    _write_versions(env, content, node, expected, by_seq, batch_size)


def _sheet_versions(env, content, document, node: str, batch_size: int) -> None:
    # One `sheets_data` reaches 75 MB, so the source is paged. The port orders
    # by `(seq, name)`, so a duplicate sequence is always adjacent and the
    # uniqueness check needs only the previous row, not the whole set.
    head = document.head_snapshot
    head_plan = None
    expected = []
    target_batch = max(1, batch_size // 2)
    by_seq = env.content_target.version_seqs(node)
    after = (0, "")
    previous = None
    while True:
        rows = env.content.sheet_snapshots(document.name, after, target_batch)
        if not rows:
            break
        for row in rows:
            # `int(None)` raises `TypeError`, which no caller catches. Zero
            # fails the bound below and is reported like any other unusable
            # sequence.
            seq = int(row.seq or 0)
            if seq < 1 or seq > MAX_VERSION_SEQ:
                raise InvalidLegacyContent("Sheet Snapshot sequence does not fit the target positive Int")
            if seq == previous:
                raise InvalidLegacyContent("Sheet Snapshot sequences are not unique")
            previous = seq
            raw = sheet_version_bytes(row.sheets_data, row.seq)
            planned = _version_row(
                env,
                row,
                node=node,
                seq=seq,
                kind=row.kind,
                label=row.label,
                pinned=int(bool(row.pinned)),
                actor=row.actor,
                raw=raw,
                filename=f"{row.name}.json",
            )
            expected.append(planned)
            if row.name == head:
                head_plan = planned
            if len(expected) >= target_batch:
                _write_versions(env, content, node, expected, by_seq, batch_size)
                expected = []
        after = (int(rows[-1].seq), rows[-1].name)
        if len(rows) < target_batch:
            break
    _write_versions(env, content, node, expected, by_seq, batch_size)

    if head:
        # §8 keeps the stored head id and repoints it at the migrated row, so
        # the head must name a snapshot this sheet really had. Every column of
        # that row is already proved by `_write_versions`; what is not implied
        # is that the id exists in the source at all.
        stored = env.content_target.version_names((head,)).get(head)
        if not head_plan or not stored:
            raise InvalidLegacyContent("Sheet head_snapshot does not name a migrated source snapshot")


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


def _write_versions(env, content, node: str, expected: list[dict], by_seq: dict, batch_size: int) -> None:
    by_name = env.content_target.version_names(tuple(row["name"] for row in expected))
    fresh = []
    # A new version can also create one File Blob in this transaction.
    target_batch = max(1, batch_size // 2)
    for planned in expected:
        content.versions_seen += 1
        stored = by_name.get(planned["name"])
        occupied = by_seq.get(planned["seq"])
        if stored:
            exact_fields(stored, planned, VERSION_FIELDS, f"version {planned['name']}")
            if occupied and occupied != planned["name"]:
                raise InvalidLegacyContent(f"version sequence {planned['seq']} is occupied")
            continue
        if occupied:
            raise InvalidLegacyContent(f"version sequence {planned['seq']} is occupied")
        by_seq[planned["seq"]] = planned["name"]
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
    """Resolve one content document's node. Steps 7, 8, and 10 share this.

    Returns the node id, or `None` when the document has no `File` row and
    no node yet: step 10 can still adopt it. Raises `RemovedLegacyFile` when
    its only `File` row is Removed, which is a skip and not a defect, and
    `InvalidLegacyContent` for every shape Build must refuse.
    """
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
        raise RemovedLegacyFile(document.doctype, document.name, file.name)
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
    content.record_issue(source, reason, phase="history")
    env.state.put_content(content)
    raise BuildHistoryError(f"{source}: {reason}")
