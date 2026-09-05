"""Supported product-facing Drive workflows.

`suite.drive` is the only Python interface into Drive for code outside
`suite/drive/`. Import it as `from suite import drive`. Callers never import
`suite.drive._core`, `suite.drive.doctype`, or a Drive DocType controller, and
never write a `Drive *` table themselves: every byte charged to a root must go
through one of the workflows below so that `Drive Root.used_bytes` stays the
one source of truth (ARCHITECTURE.md, rules 2.2, 3.2, and 5.5).

## Errors

Every workflow raises a `suite.drive._core.errors.DriveError` subclass. They
are caught by type, not by message. `DriveError` subclasses
`frappe.ValidationError` and carries an `http_status_code`, so an unhandled one
still aborts the request with the right status.

| Error | Raised when |
|---|---|
| `DriveNotFound` | the root, root pair, or reservation key does not exist |
| `DriveOverQuota` | the admission UPDATE would push `used_bytes` past the effective quota |
| `DriveConflict` | a reservation exists with different values, names another root, or a resize runs in the wrong direction |
| `frappe.ValidationError` | an argument is malformed: a negative or non-integer byte count, an empty key, a key longer than 140 characters |

## Transactions

Every reservation workflow runs inside its own SQL savepoint and rolls that
savepoint back on any failure, so a refused call leaves the counter, the
reservation row, and the caller's own writes in the state they had on entry.
None of them commits: they join the caller's transaction, and the caller
decides when to commit. A caller that must not keep a reservation on failure
therefore needs no compensation step of its own.

Ordering, which callers must respect to stay deadlock-free: each workflow
locks the `Drive Root` row (through its root pair) before the
`Drive Storage Reservation` row. Drive itself locks the `User` row before the
root when it provisions or archives a Personal Root. A caller that takes its
own locks in the same transaction takes them in that order: `User`, then its
own tables, then Drive.

A reservation is bound to its root when it is created and never moves. The
binding survives archiving: pass `root=None` to `grow`, `reduce`, and
`release` and Drive resolves the bound root itself. This is what keeps a
recording that started before its owner was offboarded charged to the archived
root rather than to a same-email replacement root.

## Permissions

These workflows are byte accounting, not access control. They do not check the
session user and they do not require one: `create_storage_reservation` and its
siblings run under whatever user the caller has set, including a background
job. The caller owns the decision that the reservation may be made. Node and
grant workflows, which do check permissions, are not exported yet.

`ensure_personal_root` refuses `Guest` and `Administrator` by returning `None`
rather than raising, and returns `None` for any user it will not provision.
`personal_root_for` returns `None` when the user has no Active Personal Root,
which is what an offboarded user looks like.

## Performance

| Workflow | Cost |
|---|---|
| `personal_root_for` | one indexed read of `Drive Root (kind, user, state)` |
| `ensure_personal_root` | the same read; on a miss, one `User` row lock plus three inserts |
| `get_storage_usage` | the root-pair read plus one `SUM(reserved_bytes)` on the `root` index |
| `get_storage_reservation` | one primary-key read, no lock |
| `create` / `grow` / `reduce` / `release` | two locking row reads and one counter UPDATE; no table scan |
| `bind_legacy_storage_reservation` | the same, plus one read to detect an already-bound row |

No workflow scans `Drive Node`. Every one is bounded work per call, so a
migration or a per-request caller can run them in a loop. They hold row locks
until the caller commits, so a caller must not keep a Drive transaction open
across a network call.
"""

from suite.drive._core.quota import (
    bind_legacy_storage_reservation,
    create_storage_reservation,
    get_storage_reservation,
    get_storage_usage,
    grow_storage_reservation,
    reduce_storage_reservation,
    release_storage_reservation,
)
from suite.drive._core.roots import (
    personal_root_for,
)
from suite.drive._core.roots import (
    provision_personal_root as ensure_personal_root,
)

__all__ = (
    "bind_legacy_storage_reservation",
    "create_storage_reservation",
    "ensure_personal_root",
    "get_storage_reservation",
    "get_storage_usage",
    "grow_storage_reservation",
    "personal_root_for",
    "reduce_storage_reservation",
    "release_storage_reservation",
)
