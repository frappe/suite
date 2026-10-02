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


class DriveFileTooLarge(DriveError):
    """One file is larger than the site accepts (§11.6).

    The bound is the site's own per-file limit, not a root's quota, so it says
    nothing about the other files in a batch. It is not 413: an upload client
    stops its whole queue on 413, because a full root refuses every file.
    """

    http_status_code = 422


class DriveConflict(DriveError):
    """A title is taken, or the tree refuses the write (§11.6).

    `free_title` is set on a title collision only. It is the title §8.6's
    dedupe rule would give, so a client offers Keep both without predicting a
    suffix. The HTTP boundary copies it into the error envelope.
    """

    http_status_code = 409

    def __init__(self, *args, free_title: str | None = None):
        super().__init__(*args)
        self.free_title = free_title


class DriveRestoreDestinationRequired(DriveConflict):
    """Restore needs a destination: the original parent chain is not Active (§8.8)."""


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
