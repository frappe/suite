from pathlib import Path

import frappe

SCHEDULER_SMOKE_METHOD = "suite.meet.api.recording.reconcile_pending_recordings"


def enqueue_worker_smoke() -> str:
    job = frappe.enqueue(mark_worker_ready, queue="short", job_id="suite-ci-worker-ready")
    return job.id


def mark_worker_ready() -> None:
    Path(frappe.get_site_path("private", "suite-ci-worker-ready")).touch()


def _scheduler_smoke_job_name() -> str:
    job_name = frappe.db.get_value("Scheduled Job Type", {"method": SCHEDULER_SMOKE_METHOD}, "name")
    if not job_name:
        raise RuntimeError(f"Scheduled job is not registered: {SCHEDULER_SMOKE_METHOD}")
    return job_name


def enable_scheduler_smoke_logging() -> None:
    job_name = _scheduler_smoke_job_name()
    frappe.db.set_value("Scheduled Job Type", job_name, "create_log", 1)


def scheduler_smoke_ran() -> bool:
    job_name = _scheduler_smoke_job_name()
    return bool(
        frappe.db.exists(
            "Scheduled Job Log",
            {"scheduled_job_type": job_name, "status": "Complete"},
        )
    )
