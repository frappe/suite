"""Documented Drive workflow failures, and the rollback that reports them."""

import frappe


class DriveError(frappe.ValidationError):
    http_status_code = 400


class DriveNotFound(DriveError):
    http_status_code = 404


class DriveForbidden(DriveError):
    http_status_code = 403


class DriveLocked(DriveError):
    http_status_code = 401


class DriveLinkExpired(DriveError):
    http_status_code = 410


class DriveOverQuota(DriveError):
    http_status_code = 413


class DriveConflict(DriveError):
    http_status_code = 409


def rollback_savepoint(savepoint: str, error: Exception) -> None:
    """Rollback one workflow without masking MariaDB's original deadlock.

    Every Drive workflow wraps its writes in a savepoint and takes `FOR UPDATE`
    locks inside it, so any of them can be the deadlock victim. InnoDB rolls
    the victim's whole transaction back and discards its savepoints, and
    `ROLLBACK TO SAVEPOINT` then fails with "SAVEPOINT does not exist". Raising
    that second error would hide the deadlock the caller has to retry on, and
    would leave the handle unreset.
    """
    try:
        frappe.db.rollback(save_point=savepoint)
    except Exception:
        if not isinstance(error, frappe.QueryDeadlockError):
            raise
        # InnoDB has already rolled back the deadlock victim's transaction,
        # including its savepoints. A full rollback safely resets the handle.
        frappe.db.rollback()
