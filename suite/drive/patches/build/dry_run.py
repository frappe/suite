"""What Build would do on this site, counted without writing a row.

    bench --site <site> execute suite.drive.patches.build.dry_run.run

Build (§14.2) reports what it did after it has done it. An operator about
to migrate production wants the same numbers before: how many nodes of
which kind, which rows Build will skip and why, which `DocShare` rows it
rewrites and which it drops, which template decks it adopts in place. This
module answers that by reading the legacy tables through the same ports
Build reads them through and applying the same rules.

The rules are Build's own wherever Build keeps them as pure functions:
`tree._within_capacity`, `tree._representable`, `tree._kind`,
`tree._trash_stamp`, `tree._sibling_groups`, `tree._classify_page`,
`root_pairs._root_rows`, `titles.SiblingTitles`, and `legacy_bytes`'s
byte classification. The walk below is the shape of `tree._walk_root`
with every write replaced by a count, and it keeps its counters in Build's
own `TreeConversion` record so the skip names match the Build report.
Where a decision had to be copied rather than called, the comment names
the function it mirrors.

It runs the preflight first (`preflight.preflight`), embeds its verdict,
and carries on with the census whatever the verdict was: the census reads
the database only, and a NO-GO site is exactly the one whose numbers an
operator wants to see.

One write, and only one: the report, as JSON, under the site's private
directory as `drive-build-dry-run-<timestamp>.json`. Nothing touches the
database, the bucket, Build's durable record, or its copy ledger.
"""

import json
import os
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import frappe

from suite.drive.patches.build.environment import ACCEPT_SKIPS_CONFIG_KEY, BUILD_BATCH_SIZE, BuildEnvironment
from suite.drive.patches.build.gate import BuildGateError
from suite.drive.patches.build.legacy import S3_URL_PREFIX, key_shape, storage_key
from suite.drive.patches.build.legacy_bytes import LOCAL_PREFIXES, handled_prefixes, names_no_bytes
from suite.drive.patches.build.ports import DRIVE_ROOT_ROW, REMOVED, TRASHED, USERS_ROW
from suite.drive.patches.build.preflight import (
    MIGRATED_ALREADY,
    NO_GO,
    DiskSettings,
    PreflightReport,
    legacy_schema_present,
    preflight,
    table,
)
from suite.drive.patches.build.root_pairs import PERSONAL, SHARED, _root_rows
from suite.drive.patches.build.skips import REFUSING_COUNTERS, REPORTED_COUNTERS
from suite.drive.patches.build.state import SkippedRow, TitleRename, TreeConversion
from suite.drive.patches.build.titles import SiblingTitles, order_key
from suite.drive.patches.build.tree import (
    CONTAINER_KINDS,
    DEPTH_CAP,
    PARENT_CHUNK,
    PATH_CAPACITY,
    _classify_page,
    _Context,
    _kind,
    _representable,
    _sibling_groups,
    _trash_stamp,
    _within_capacity,
)

RESULT_PREFIX = "drive-build-dry-run"

# How many row ids each evidence list keeps. The counters stay exact.
ROWS_LISTED = 50

# What Build does with a `DocShare` row, by `share_doctype`. Sheet rows are
# step 6 (`grants`); the two content doctypes are step 10
# (`content._convert_content_shares`), which drops every other governed
# doctype because history and child rows carry no node.
DOCSHARE_FATES = {
    "Sheet": "rewritten as grants on the sheet's node (step 6)",
    "Writer Document": "rewritten as grants on the document's node (step 10)",
    "Presentation": "rewritten as grants on the deck's node (step 10)",
}
DOCSHARE_DROPPED = "dropped (step 10): history or a child row, which has no node"

# Byte sources for a file node, in the order `legacy_bytes` sorts rows.
BYTES_LINKED = "already linked to a blob"
BYTES_S3 = "copied from the legacy S3 layout"
BYTES_LOCAL = "linked in place by the framework backfill"
BYTES_NONE = "nothing to carry: empty, external or asset URL"
BYTES_UNREACHABLE = "bytes Build cannot reach: node with no blob"

# Outcomes for a content document, from `history._document_node`,
# `content._link_one`, and `templates._adoptable_node`.
CONTENT_LINKED = "linked to the node its File row becomes"
CONTENT_ADOPTED_TEMPLATE = "template deck adopted on its existing node"
CONTENT_CREATED_TEMPLATE = "template deck created under Templates"
CONTENT_ORPHAN = "orphan: adopted with a new node (step 10)"
CONTENT_PURGED = "purged: its only File row is Removed"
CONTENT_REFUSED_MANY = "refused: more than one File row"
CONTENT_REFUSED_UNCONVERTED = "refused: its File row gets no node"


@dataclass
class Census:
    """Every number the dry run derives from the legacy tables."""

    root_folder: str = ""
    roots: Counter = field(default_factory=Counter)
    roots_naming_no_user: list[str] = field(default_factory=list)
    status: Counter = field(default_factory=Counter)
    kinds: Counter = field(default_factory=Counter)
    documents: Counter = field(default_factory=Counter)
    nodes_trashed: int = 0
    file_bytes: Counter = field(default_factory=Counter)
    file_s3_shapes: Counter = field(default_factory=Counter)
    # The walk's counters, in Build's own record type so the depth, path,
    # link and title rules are the functions Build runs. Never saved.
    tree: TreeConversion = field(default_factory=TreeConversion)
    outside_rows: int = 0
    permission_rows: int = 0
    docshares: Counter = field(default_factory=Counter)
    content: dict[str, Counter] = field(default_factory=dict)
    writer_templates: int = 0
    # Rows the walk met, so the chain pass counts each status once; rows
    # that get a node, so the chain pass leaves them out the way
    # `LegacyTree.unreached` leaves migrated rows out after Build; and the
    # `File` id each converted content document's node takes, for the
    # template and orphan rules.
    seen: set[str] = field(default_factory=set)
    converted: set[str] = field(default_factory=set)
    converted_documents: dict[tuple[str, str], str] = field(default_factory=dict)

    def as_dict(self) -> dict:
        tree = self.tree
        refusing = {name: getattr(tree, name) for name in REFUSING_COUNTERS}
        return {
            "roots": dict(self.roots),
            "roots_naming_no_user": list(self.roots_naming_no_user),
            "file_rows_by_status": dict(self.status),
            "nodes_by_kind": dict(self.kinds),
            "document_nodes_by_content_doctype": dict(self.documents),
            "nodes_trashed": self.nodes_trashed,
            "title_renames": tree.title_renames,
            "file_nodes_by_byte_source": dict(self.file_bytes),
            "file_nodes_s3_by_shape": dict(self.file_s3_shapes),
            "skips": {
                "refusing": refusing,
                "refusing_total": sum(refusing.values()),
                "reported": {name: getattr(tree, name) for name in REPORTED_COUNTERS},
            },
            "skipped_rows": [{"file": row.file, "reason": row.reason} for row in tree.skipped[:ROWS_LISTED]],
            "skipped_rows_total": tree.skipped_total,
            "rows_outside_drive": self.outside_rows,
            "capacity": {
                "max_depth": tree.max_depth,
                "depth_cap": DEPTH_CAP,
                "max_path_length": tree.max_path_length,
                "path_capacity": PATH_CAPACITY,
                "max_id_length": tree.max_id_length,
            },
            "drive_permission_rows": self.permission_rows,
            "docshare_rows": [
                {
                    "share_doctype": doctype,
                    "rows": count,
                    "fate": DOCSHARE_FATES.get(doctype, DOCSHARE_DROPPED),
                }
                for doctype, count in sorted(self.docshares.items())
            ],
            "content_documents": {doctype: dict(counts) for doctype, counts in self.content.items()},
            "writer_templates_converted": self.writer_templates,
        }


@dataclass
class DryRun:
    """What `run` prints and saves: the preflight, the census, the file."""

    preflight: PreflightReport
    report: dict
    path: Path

    def render(self) -> str:
        return "\n".join(
            [
                f"Drive Build dry run: {self.report['verdict']}",
                "",
                self.preflight.render(),
                "",
                render_census(self.report),
            ]
        )


def dry_run(
    env,
    *,
    directory: Path,
    disk: DiskSettings | None = None,
    batch_size: int = BUILD_BATCH_SIZE,
) -> DryRun:
    """Preflight, census, one JSON file."""
    disk = disk or DiskSettings()
    flight = preflight(env, disk=disk, batch_size=batch_size)
    census = take_census(env, root_folder=disk.root_folder, batch_size=batch_size)
    report = {
        "generated_at": env.now(),
        "verdict": flight.verdict,
        "preflight": flight.as_dict(),
        **census.as_dict(),
    }
    return DryRun(flight, report, _save(report, directory))


def run() -> None:
    """The `bench execute` entry point: print the report, save it, return None."""
    try:
        env = BuildEnvironment.for_site()
    except BuildGateError as refusal:
        print(f"Drive Build dry run: {NO_GO}\n\n  [FAILED] upgrade floor\n         {refusal}")
        return
    if not legacy_schema_present():
        print(f"Drive Build dry run: {NO_GO}\n\n{MIGRATED_ALREADY}")
        return
    result = dry_run(env, disk=DiskSettings.for_site(), directory=Path(frappe.get_site_path("private")))
    print(result.render())
    print(f"\nSaved as JSON: {result.path}")


def take_census(env, *, root_folder: str = "", batch_size: int = BUILD_BATCH_SIZE) -> Census:
    """Apply Build's tree, grant, and content rules to the source rows. Reads only."""
    census = Census(root_folder=root_folder)
    for root in _roots(env, census, batch_size):
        _walk_root(env, census, root, batch_size)
    _classify_unreached(env, census, batch_size)
    _count_permissions(env, census, batch_size)
    if env.content is not None:
        _count_docshares(env, census, batch_size)
        _count_content(env, census, batch_size)
    return census


def _roots(env, census: Census, batch_size: int) -> list[str]:
    """The root pairs step 4 would publish, and the ones it would skip.

    Mirrors `root_pairs._reconcile` and `root_pairs._metadata_state`: a
    Removed root or a `Users/<email>` folder with no email is skipped; a
    Trashed root, a second folder for one email, and a disabled or missing
    `User` are published Archived; the first folder for an enabled user is
    Active. The `Users` row itself is dropped (§14.3), as `tree._record`
    drops it.
    """
    roots: list[str] = []
    claimed: set[str] = set()
    tree = census.tree
    for row in _root_rows(env, batch_size):
        census.seen.add(row.name)
        census.status[row.status] += 1
        kind = SHARED if row.name == DRIVE_ROOT_ROW else PERSONAL
        user = None if kind == SHARED else (row.file_name or "").strip()
        if row.status == REMOVED:
            census.roots[f"{kind}, skipped: root folder is Removed"] += 1
            tree.roots_skipped += 1
            tree.record_skip(SkippedRow(row.name, "root folder status is Removed"))
            continue
        if kind == PERSONAL and not user:
            census.roots["Personal, skipped: Users folder names no email"] += 1
            tree.roots_skipped += 1
            tree.record_skip(SkippedRow(row.name, "a Users/<email> folder names no user"))
            continue
        if row.status == TRASHED:
            census.roots[f"{kind}, Archived: root folder is Trashed"] += 1
        elif kind == SHARED:
            census.roots["Shared, Active"] += 1
        elif user in claimed:
            census.roots["Personal, Archived: a second folder for one email"] += 1
        else:
            enabled = env.tree.user_enabled(user)
            if enabled is None:
                census.roots["Personal, Archived: no User row for the email"] += 1
                if len(census.roots_naming_no_user) < ROWS_LISTED:
                    census.roots_naming_no_user.append(f"{row.name} ({user})")
            elif not enabled:
                census.roots["Personal, Archived: User is disabled"] += 1
            else:
                census.roots["Personal, Active"] += 1
                claimed.add(user)
        tree.max_id_length = max(tree.max_id_length, len(row.name))
        census.converted.add(row.name)
        roots.append(row.name)
    return roots


def _walk_root(env, census: Census, root: str, batch_size: int) -> None:
    """`tree._walk_root` and `tree._convert_level`, with no batch to flush."""
    level = {root: _Context(root, root, "", 0, "root")}
    while level:
        contexts: dict[str, _Context] = {}
        parents = sorted(level)
        for start in range(0, len(parents), PARENT_CHUNK):
            chunk = tuple(parents[start : start + PARENT_CHUNK])
            for folder, rows in _sibling_groups(env, chunk, batch_size):
                contexts.update(_count_siblings(env, census, level[folder], rows))
        level = contexts


def _count_siblings(env, census: Census, parent: _Context, rows) -> dict[str, _Context]:
    """`tree._convert_siblings`, deciding every row and writing none."""
    tree = census.tree
    for row in rows:
        census.seen.add(row.name)
        census.status[row.status] += 1
    if parent.kind not in CONTAINER_KINDS:
        for row in rows:
            tree.invalid_parent_skipped += 1
            tree.record_skip(
                SkippedRow(row.name, f"parent {parent.node} is a {parent.kind}, not a container")
            )
        return {}

    contexts: dict[str, _Context] = {}
    taken = SiblingTitles()
    for row in sorted(rows, key=order_key):
        stamp = _trash_stamp(row, parent)
        if row.status == REMOVED:
            # Not descended into. The chain pass counts the row and its
            # subtree as `removed_rows_skipped`, as Build's census does.
            continue
        if not _within_capacity(tree, parent, row):
            continue
        if not _representable(tree, row):
            continue
        kind = _kind(row)
        census.kinds[kind] += 1
        census.converted.add(row.name)
        tree.max_id_length = max(tree.max_id_length, len(row.name))
        if stamp is None:
            title = (row.file_name or "").strip() or row.name
            claimed = taken.claim(title)
            if claimed != title:
                tree.record_rename(TitleRename(row.name, title, claimed))
        else:
            census.nodes_trashed += 1
        if kind == "document":
            census.documents[row.content_doctype] += 1
            census.converted_documents[(row.content_doctype, row.content_docname)] = row.name
        elif kind == "file":
            _count_file_bytes(env, census, row)
        trash_root, trashed_at = stamp if stamp else (None, None)
        contexts[row.name] = _Context(
            row.name,
            parent.root,
            f"{parent.child_path or '/'}{row.name}/",
            parent.depth + 1,
            kind,
            trash_root,
            trashed_at,
        )
    return contexts


def _count_file_bytes(env, census: Census, row) -> None:
    """Where one file node's bytes come from, as `legacy_bytes` sorts rows."""
    url = row.file_url or ""
    if row.blob:
        census.file_bytes[BYTES_LINKED] += 1
    elif S3_URL_PREFIX in handled_prefixes(env) and url.startswith(S3_URL_PREFIX):
        census.file_bytes[BYTES_S3] += 1
        census.file_s3_shapes[key_shape(storage_key(url), census.root_folder)] += 1
    elif url.startswith(LOCAL_PREFIXES):
        census.file_bytes[BYTES_LOCAL] += 1
    elif names_no_bytes(row):
        census.file_bytes[BYTES_NONE] += 1
    else:
        census.file_bytes[BYTES_UNREACHABLE] += 1


def _classify_unreached(env, census: Census, batch_size: int) -> None:
    """`tree.take_census` and `tree._record` over every row without a node.

    Before Build, `LegacyTree.unreached` answers every row, so the rows the
    walk gives a node are dropped here first. What is left climbs its
    `folder` chain through `tree._classify_page`: a dangling or cyclic chain
    is a broken chain; a chain that reaches a Drive root through something
    Removed is a Removed subtree; one that reaches a Drive root with nothing
    Removed is `unmigrated_reachable`, which before Build means the rows
    the walk refused (depth, parent, shape, or a skipped root) and
    everything below them; anything else is not Drive's.
    """
    memo: dict[str, tuple[str, bool]] = {}
    tree = census.tree
    after = ""
    previous_page = None
    while True:
        rows = env.tree.unreached(after, batch_size)
        if not rows:
            return
        if rows[0].name == previous_page:
            raise RuntimeError(f"the census cursor stalled at {rows[0].name!r}; refusing to loop")
        previous_page = rows[0].name
        for row in rows:
            if row.name not in census.seen:
                census.seen.add(row.name)
                census.status[row.status] += 1
        pending = [row for row in rows if row.name not in census.converted and row.name != USERS_ROW]
        for name, (kind, removed) in _classify_page(env, pending, memo).items():
            if kind == "broken":
                tree.broken_chains_skipped += 1
                tree.record_skip(SkippedRow(name, "the folder chain does not terminate"))
            elif kind == "drive" and removed:
                tree.removed_rows_skipped += 1
            elif kind == "drive":
                tree.unmigrated_reachable += 1
                tree.record_skip(
                    SkippedRow(
                        name, "reachable from a Drive root and gets no node: refused, or below a refused row"
                    )
                )
            else:
                census.outside_rows += 1
        after = rows[-1].name
        if len(rows) < batch_size:
            return


def _count_permissions(env, census: Census, batch_size: int) -> None:
    after = ("", "", "")
    while True:
        rows = env.tree.permissions(after, batch_size)
        census.permission_rows += len(rows)
        if len(rows) < batch_size:
            return
        after = (rows[-1].entity, rows[-1].user, rows[-1].name)


def _count_docshares(env, census: Census, batch_size: int) -> None:
    """Every `DocShare` row Build reads, by `share_doctype`.

    `LegacyTree.docshares` is the Sheet rows step 6 reads;
    `LegacyContent.content_shares` is every other governed doctype step 10
    reads. The two never overlap.
    """
    after = ""
    while True:
        rows = env.tree.docshares(after, batch_size)
        census.docshares["Sheet"] += len(rows)
        if len(rows) < batch_size:
            break
        after = rows[-1].name
    after = ""
    while True:
        rows = env.content.content_shares(after, batch_size)
        for row in rows:
            census.docshares[row.share_doctype] += 1
        if len(rows) < batch_size:
            break
        after = rows[-1].name


def _count_content(env, census: Census, batch_size: int) -> None:
    """What steps 7, 8, and 10 do with each content document."""
    for doctype in ("Writer Document", "Sheet", "Presentation"):
        counts = census.content.setdefault(doctype, Counter())
        after = ""
        while True:
            rows = env.content.documents(doctype, after, batch_size)
            for row in rows:
                counts["rows"] += 1
                counts[_content_fate(env, census, row)] += 1
            if len(rows) < batch_size:
                break
            after = rows[-1].name
    after = ""
    while True:
        rows = env.content.writer_templates(after, batch_size)
        census.writer_templates += len(rows)
        if len(rows) < batch_size:
            break
        after = rows[-1].name


def _content_fate(env, census: Census, row) -> str:
    """`history._document_node`'s four answers, then `templates._adoptable_node`.

    No `File` row: an orphan step 10 adopts, or a template deck step 7
    creates under `Templates`. More than one: refused. One that is Removed:
    purged (`RemovedLegacyFile`). One the walk converts: linked, or for a
    template deck adopted in place, unless the node would carry the deck's
    own id, which `_adoptable_node` treats as the deck having no node yet.
    """
    template = row.doctype == "Presentation" and bool(row.is_template)
    files = env.content.files_for_content(row.doctype, row.name)
    if not files:
        return CONTENT_CREATED_TEMPLATE if template else CONTENT_ORPHAN
    if len(files) != 1:
        return CONTENT_REFUSED_MANY
    file = files[0]
    if file.status == REMOVED:
        return CONTENT_PURGED
    if census.converted_documents.get((row.doctype, row.name)) != file.name:
        return CONTENT_REFUSED_UNCONVERTED
    if template:
        return CONTENT_ADOPTED_TEMPLATE if file.name != row.name else CONTENT_CREATED_TEMPLATE
    return CONTENT_LINKED


def render_census(report: dict) -> str:
    """The census as the operator reads it in the terminal."""
    lines = ["Roots (step 4)"]
    lines.extend(table(("outcome", "rows"), sorted(report["roots"].items())))
    for entry in report["roots_naming_no_user"]:
        lines.append(f"    no User row: {entry}")
    lines.append("")
    lines.append("Legacy File rows by status")
    lines.extend(table(("status", "rows"), sorted(report["file_rows_by_status"].items())))
    lines.append(f"  not Drive's (frappe attachments, Home): {report['rows_outside_drive']}")
    lines.append("")
    lines.append("Nodes Build writes (step 5)")
    lines.extend(table(("kind", "nodes"), sorted(report["nodes_by_kind"].items())))
    if report["document_nodes_by_content_doctype"]:
        lines.extend(
            table(
                ("document nodes by content_doctype", "nodes"),
                sorted(report["document_nodes_by_content_doctype"].items()),
            )
        )
    lines.append(f"  nodes landing in the trash: {report['nodes_trashed']}")
    lines.append(f"  titles given a ' (n)' suffix: {report['title_renames']}")
    lines.append("")
    lines.append("File nodes by where their bytes come from")
    lines.extend(table(("source", "nodes"), sorted(report["file_nodes_by_byte_source"].items())))
    if report["file_nodes_s3_by_shape"]:
        lines.extend(
            table(("legacy S3 key shape", "nodes"), sorted(report["file_nodes_s3_by_shape"].items()))
        )
    lines.append("")
    skips = report["skips"]
    lines.append("Rows Build skips")
    lines.extend(table(("refusing: Build stops until accepted", "rows"), sorted(skips["refusing"].items())))
    lines.extend(table(("reported only", "rows"), sorted(skips["reported"].items())))
    if skips["refusing_total"]:
        lines.append(
            f"  Build refuses to finish while the refusing counters are above zero, unless site_config "
            f"carries `{ACCEPT_SKIPS_CONFIG_KEY}`. A refused row is counted under its own reason and again "
            "as unmigrated_reachable, as Build's report counts it."
        )
    for row in report["skipped_rows"]:
        lines.append(f"    {row['file']}: {row['reason']}")
    if report["skipped_rows_total"] > len(report["skipped_rows"]):
        lines.append(f"    ... and {report['skipped_rows_total'] - len(report['skipped_rows'])} more")
    lines.append("")
    capacity = report["capacity"]
    lines.append("Capacity (§3.1)")
    lines.append(f"  max depth {capacity['max_depth']} of {capacity['depth_cap']}")
    lines.append(f"  max path length {capacity['max_path_length']} of {capacity['path_capacity']}")
    lines.append(f"  max id length {capacity['max_id_length']}")
    lines.append("")
    lines.append("Grants (steps 6 and 10)")
    lines.append(f"  Drive Permission rows: {report['drive_permission_rows']}")
    if report["docshare_rows"]:
        lines.extend(
            table(
                ("DocShare share_doctype", "rows", "fate"),
                [(row["share_doctype"], row["rows"], row["fate"]) for row in report["docshare_rows"]],
            )
        )
    else:
        lines.append("  DocShare rows: 0")
    lines.append("")
    lines.append("Content documents (steps 7, 8 and 10)")
    for doctype, counts in report["content_documents"].items():
        ordered = sorted(counts.items(), key=lambda item: (item[0] != "rows", item[0]))
        lines.extend(table((doctype, "rows"), ordered))
    lines.append(f"  Writer Template rows converted: {report['writer_templates_converted']}")
    return "\n".join(lines)


def _save(report: dict, directory: Path) -> Path:
    """One immutable JSON file per run, never overwriting an earlier one."""
    directory.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    index = 0
    while True:
        suffix = f"-{index}" if index else ""
        path = directory / f"{RESULT_PREFIX}-{stamp}{suffix}.json"
        try:
            handle = open(path, "x", encoding="utf-8")
        except FileExistsError:
            index += 1
            continue
        break
    with handle:
        json.dump(report, handle, indent=2, sort_keys=True, default=str)
        handle.flush()
        os.fsync(handle.fileno())
    return path
