"""§14.2 step 13 and §14.9: the report, printed and saved privately.

Every key §14.9 names is produced here, spelled exactly as the spec spells
it, and read out of the durable record rather than out of this run's memory
(§14.2 makes a rerun skip complete records, so the numbers a single run
happens to have written are not the migration's numbers).

Three rules the spec states and this module enforces:

- **Saved privately.** Under the site's private directory, beside the Build
  record, which is not served by the web layer.
- **Evidence survives a rerun.** Each run writes its own immutable file and
  refreshes a `latest` pointer. No run overwrites an earlier report, because
  the run that did the work and the rerun that confirmed it report different
  numbers and both are evidence.
- **No link secrets.** `links_minted` is a count and the record keeps node
  ids, never tokens. The serialized report is checked for a `$LINK:`
  principal before it is written or printed, so a future field that carried
  one would fail loudly instead of writing a credential to a file and to the
  migration log.
"""

import json
import os
import time
from pathlib import Path

import frappe

from suite.drive.patches.build.state import DROP_REASONS

REPORT_FILENAME = "drive-build-report.json"
REPORT_PREFIX = "drive-build-report"

# §4.4: the principal spelling that carries a share-link token.
LINK_PREFIX = "$LINK:"

# §14.9, in the spec's own order. The report is compared against this tuple,
# so a key that is dropped or misspelled fails rather than going unnoticed.
REPORT_KEYS = (
    "removed_rows_skipped",
    "broken_chains_skipped",
    "blobless_nodes",
    "title_renames",
    "grant_rows_dropped",
    "links_minted",
    "docshare_rows_dropped",
    "trash_disagreements",
    "orphan_content_docs_adopted",
    "activity_rows_dropped",
    "activity_verbs_derived",
    "versions_to_thin",
    "s3_objects_copied",
    "s3_bytes_copied",
    "personal_roots_created_for_reservations",
    "media_nodes_created",
    "media_duplicates_collapsed",
    "slide_elements_rewritten",
    "deck_previews_created",
    "template_nodes_created",
    "writer_templates_converted",
    "composite_rows_dropped",
)


class BuildReportError(frappe.ValidationError):
    """The report cannot be produced, or would publish a secret."""


def build_report(env) -> dict:
    """Assemble §14.9's document out of the durable Build record."""
    storage = env.state.storage()
    tree = env.state.tree()
    grants = env.state.grants()
    content = env.state.content()
    records = env.state.records()
    settings = env.state.settings()
    usage = env.state.usage()

    report = {
        "removed_rows_skipped": tree.removed_rows_skipped,
        "broken_chains_skipped": tree.broken_chains_skipped,
        # Two steps mint nodes that can lack bytes: the tree walk, and the
        # Slides media conversion. §14.9 has one key, so it is their sum.
        "blobless_nodes": tree.blobless_nodes + content.blobless_nodes,
        "title_renames": tree.title_renames + content.title_renames,
        "grant_rows_dropped": {reason: grants.grant_rows_dropped.get(reason, 0) for reason in DROP_REASONS},
        "links_minted": grants.links_minted,
        # `Drive Permission` supplies the Sheet `DocShare` rows and step 10
        # supplies the Writer and Slides ones. One key, both sources.
        "docshare_rows_dropped": grants.docshare_rows_dropped + content.docshare_rows_dropped,
        "trash_disagreements": content.trash_disagreements,
        "orphan_content_docs_adopted": content.orphan_content_docs_adopted,
        "activity_rows_dropped": records.activity_rows_dropped,
        "activity_verbs_derived": records.activity_verbs_derived,
        "versions_to_thin": content.versions_to_thin,
        "s3_objects_copied": storage.s3_objects_copied,
        "s3_bytes_copied": storage.s3_bytes_copied,
        "personal_roots_created_for_reservations": settings.personal_roots_created_for_reservations,
        "media_nodes_created": content.media_nodes_created,
        "media_duplicates_collapsed": content.media_duplicates_collapsed,
        "slide_elements_rewritten": content.slide_elements_rewritten,
        "deck_previews_created": content.deck_previews_created,
        "template_nodes_created": content.template_nodes_created,
        "writer_templates_converted": content.writer_templates_converted,
        "composite_rows_dropped": grants.composite_rows_dropped,
    }
    missing = [key for key in REPORT_KEYS if key not in report]
    extra = [key for key in report if key not in REPORT_KEYS]
    if missing or extra:
        raise BuildReportError(f"the §14.9 report keys are wrong: missing {missing}, extra {extra}")

    report["generated_at"] = env.now()
    # Everything §14.9 does not name, kept out of its namespace so the
    # specified keys stay exactly the specified keys.
    report["evidence"] = {
        "storage": storage.as_dict(),
        "tree": tree.as_dict(),
        "grants": grants.as_dict(),
        "content": content.as_dict(),
        "records": records.as_dict(),
        "settings": settings.as_dict(),
        "usage": usage.as_dict(),
    }
    # Serialize once here so a secret is refused at the moment the report is
    # assembled, rather than only on the path that happens to write it.
    _serialized(report)
    return report


def save_report(env, report: dict) -> str:
    """Write one immutable report and refresh the `latest` pointer.

    Returns the immutable file's path. Every run opens its file with `x`, so
    no run can overwrite an earlier report even by accident, and the index
    rises until the name is free: two runs inside one second are what a
    rerun that only had to finish the last batch looks like.
    """
    body = _serialized(report)
    directory = _private_directory()
    directory.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    index = 1
    while True:
        path = directory / f"{REPORT_PREFIX}-{stamp}-{index}.json"
        try:
            handle = open(path, "x", encoding="utf-8")
        except FileExistsError:
            index += 1
            continue
        break
    with handle:
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())
    latest = directory / REPORT_FILENAME
    temporary = latest.with_suffix(f".{os.getpid()}.tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, latest)

    record = env.state.report()
    record.record(report.get("generated_at") or stamp, path.name)
    env.state.put_report(record)
    return str(path)


def print_report(report: dict) -> None:
    """Print §14.9's keys to the migration log, and nothing else.

    The evidence block stays in the file. It is unbounded, and a migration
    log is read by a person looking for the four numbers §14.9 says the
    owners have to be told about.
    """
    printed = {key: report[key] for key in REPORT_KEYS}
    # A migration patch reports to its log.
    print(_serialized(printed))


def produce_report(env) -> tuple[dict, str]:
    """§14.2 step 13: assemble, save privately, and print."""
    report = build_report(env)
    path = save_report(env, report)
    print_report(report)
    return report, path


def _serialized(report: dict) -> str:
    body = json.dumps(report, indent=2, sort_keys=True, default=str)
    if LINK_PREFIX in body:
        raise BuildReportError(
            "the Build report contains a share-link principal. §14.9 reports how many "
            "links were minted, never which token any of them carries."
        )
    return body


def _private_directory() -> Path:
    return Path(frappe.get_site_path("private"))
