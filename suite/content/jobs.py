"""The layer's queued and scheduled jobs, for every app; the scheduler and the queue name them by these paths."""

import frappe

from suite.content import (
    checkpoints,
    conversions,
    convert,
    copies,
    log,
    scheduling,
    stage,
    suspect,
    touches,
    trimming,
)
from suite.content.editors import editors, spec_of

COMPACT = "suite.content.jobs.compact"
JUDGE = "suite.content.jobs.judge"
DELETE_PURGED = "suite.content.jobs.delete_purged"
TRIM = "suite.content.jobs.trim"
CHECK_RENDER = "suite.content.jobs.check_render"
CONVERT = "suite.content.jobs.convert_pending"


def delete_purged(app: str, doc_id: str) -> None:
    """Delete a purged document's log, as its queued job."""
    log.delete_purged(app, doc_id)


def compact(app: str, doc_id: str) -> None:
    """Compact the document's log, as its queued job."""
    spec = spec_of(app)
    checkpoints.run(app, doc_id, spec.part_map, JUDGE)


def trim(app: str) -> None:
    """Run one app's trimming, as its queued job."""
    spec = spec_of(app)
    trimming.run(app, spec.part_map, spec.checker_build)


def trim_logs() -> None:
    """Hourly: one trimming job per app, which resumes where the last one stopped."""
    for app in editors():
        frappe.enqueue(
            TRIM,
            queue="long",
            timeout=trimming.TIMEOUT,
            job_id=f"suite-collab-trim-{app}",
            deduplicate=True,
            app=app,
        )


def queue_conversion() -> None:
    """Every few minutes: one conversion job for each app with old documents to convert."""
    for app, spec in editors().items():
        if spec.conversion is None or not convert.may_convert(app):
            continue

        frappe.enqueue(
            CONVERT,
            queue="long",
            timeout=convert.TIMEOUT,
            job_id=f"suite-convert-{app}",
            deduplicate=True,
            app=app,
        )


def convert_pending(app: str) -> None:
    """Convert the app's documents that have no log yet, as its queued job."""
    conversion = spec_of(app).conversion
    if conversion is not None and convert.may_convert(app):
        conversions.run_pending(app, conversion)


def judge(app: str, doc_id: str) -> None:
    """Judge a suspect document, and ask for a compaction once it is settled."""
    spec = spec_of(app)
    verdict = suspect.judge(app, doc_id, spec.part_map, spec.checker_build)
    if verdict in {"clean", "quarantined"}:
        scheduling.request_if_due(app, doc_id, COMPACT)


def check_render(app: str, doc_id: str) -> None:
    """Check the document's newest whole staged render as its readable copy."""
    copies.check_staged(app, doc_id)


def request_render_check(app: str, doc_id: str) -> None:
    """Enqueue the document's copy check once."""
    scheduling.enqueue(CHECK_RENDER, f"suite-collab-render-{app}-{doc_id}", app=app, doc_id=doc_id)


def sweep() -> None:
    """Sweep every app's logs for due compactions, touches and staged renders to check."""
    for app, spec in editors().items():
        scheduling.sweep(app, COMPACT, purge_method=DELETE_PURGED, judge_method=JUDGE)
        touches.sweep(app)
        if spec.readable_copy is None:
            continue

        for doc_id in stage.rendered_docs(app):
            request_render_check(app, doc_id)
