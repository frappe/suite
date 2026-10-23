"""§14.2 step 11 and §14.8: quotas in bytes, reservations on roots.

Three mappings, all from a legacy column Build reads and does not remove:

- `Drive Disk Settings.quota`, a site default in MB, becomes
  `default_personal_quota` in bytes. `shared_quota` starts at 0, which §3.2
  and §7.4 spell "unlimited".
- `Drive Settings.quota`, a per-user default in MB, becomes that user's
  Personal Root `quota_bytes`. A user with no Personal Root keeps the legacy
  value and is counted: §14.8 creates a root for a reservation owner, and
  for nobody else.
- `Drive Storage Reservation.storage_owner`, a User, becomes `root`. The
  owner's Personal Root is created when it is missing, as a whole pair.

`used_bytes` is deliberately untouched. §14.8 says the mapping does not
write it and step 12 recomputes it as the last thing Build does.
"""

import frappe

from suite.drive.patches.build.content import _ensure_personal_root
from suite.drive.patches.build.content_mapping import InvalidLegacyContent
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.ports import ACTIVE, PERSONAL
from suite.drive.patches.build.root_pairs import ARCHIVED
from suite.drive.patches.build.state import SettingsConversion, SkippedRow

# §14.8: "(bytes, value x 1024^2)".
MEGABYTE = 1024**2


class BuildSettingsError(frappe.ValidationError):
    """Step 11 cannot run, or found settings it must not write through."""


def convert_settings(env, *, batch_size: int = BUILD_BATCH_SIZE) -> SettingsConversion:
    """Implement §14.2 step 11 (§14.8)."""
    if not env.state.tree().completed:
        raise BuildSettingsError("ticket 27 tree conversion must complete before step 11")
    source, target = _ports(env)
    result = env.state.settings()
    result.begin_run()
    env.state.put_settings(result)

    _convert_site_quota(source, target, result)
    env.state.put_settings(result)
    _convert_user_quotas(env, source, target, result, batch_size)
    _convert_reservations(env, source, target, result, batch_size)

    result.completed = True
    env.state.put_settings(result)
    return result


def _convert_site_quota(source, target, result) -> None:
    """§14.8's first two rows, in one write."""
    quota_mb = max(int(source.disk_quota_mb() or 0), 0)
    default_personal = quota_mb * MEGABYTE
    shared = 0
    result.disk_quota_mb = quota_mb
    result.default_personal_quota = default_personal
    result.shared_quota = shared
    if target.site_quotas() != (default_personal, shared):
        target.set_site_quotas(default_personal, shared)
        target.commit()


def _convert_user_quotas(env, source, target, result, batch_size) -> None:
    """Move each `Drive Settings.quota` onto its user's Personal Root."""
    after = ""
    written = 0
    while True:
        rows = source.user_quotas(after, batch_size)
        if not rows:
            break
        for row in rows:
            result.user_quota_rows_seen += 1
            quota = max(int(row.quota or 0), 0)
            if not row.user or quota <= 0:
                # §14.8 maps a quota above zero. Zero already means "inherit
                # the site default" on both sides, so there is nothing to
                # write and nothing lost.
                continue
            root = _existing_personal_root(env, row.user)
            if root is None:
                result.user_quotas_without_root += 1
                result.record_skip(SkippedRow(row.name, f"{row.user} has no Personal Root for a quota"))
                continue
            wanted = quota * MEGABYTE
            if target.root_quota(root) == wanted:
                result.user_quotas_already_set += 1
                continue
            target.set_root_quota(root, wanted)
            result.user_quotas_applied += 1
            written += 1
            if written >= batch_size:
                target.commit()
                env.state.put_settings(result)
                written = 0
        after = rows[-1].name
        if len(rows) < batch_size:
            break
    target.commit()
    env.state.put_settings(result)


def _convert_reservations(env, source, target, result, batch_size) -> None:
    """§3.12: move each reservation from its owner to that owner's root.

    A created root is counted through the same write-ahead ledger a minted
    link uses. The intent is persisted before the commit that publishes the
    pair, and cleared only after it, so a kill on either side of that commit
    leaves a total that is neither doubled nor lost.
    """
    _recover_root_intents(env, result)

    after = ""
    written = 0
    minted: list[str] = []

    def flush():
        nonlocal written, minted
        target.commit()
        result.finish_roots(minted)
        minted = []
        written = 0
        env.state.put_settings(result)

    while True:
        rows = source.reservations(after, batch_size)
        if not rows:
            break
        for row in rows:
            result.reservations_seen += 1
            if row.root:
                result.reservations_already_bound += 1
                continue
            owner = (row.storage_owner or "").strip()
            if not owner:
                result.reservations_unowned += 1
                result.record_skip(SkippedRow(row.name, "a reservation names neither a root nor an owner"))
                continue
            created = []

            def reserve(_rows, created=created):
                created.append(True)

            try:
                root = _ensure_personal_root(env, owner, reserve)
            except InvalidLegacyContent as error:
                result.record_skip(SkippedRow(row.name, str(error)))
                raise BuildSettingsError(f"{row.name}: {error}") from error
            if created:
                result.prepare_root(root)
                minted.append(root)
                env.state.put_settings(result)
                written += 3
            target.bind_reservation(row.name, root)
            result.reservations_bound += 1
            written += 1
            if written >= batch_size:
                flush()
        after = rows[-1].name
        if len(rows) < batch_size:
            break
    flush()


def _recover_root_intents(env, result) -> None:
    """Settle the ledger a killed run left behind, before writing more.

    The same shape as the grant step's link ledger. A pending id that is a
    Personal Root today means the commit landed and only the cumulative
    count still needs advancing. One that is not was rolled back with its
    batch, and the reservation walk mints a fresh id for that owner, so the
    stale intent is dropped instead of being carried for ever.
    """
    pending = list(result.pending_reservation_roots)
    if not pending:
        return
    target = env.content_target
    landed = []
    for node in pending:
        metadata = target.root_metadata(node)
        if metadata and metadata.get("kind") == PERSONAL:
            landed.append(node)
    result.finish_roots(landed)
    result.pending_reservation_roots = []
    env.state.put_settings(result)


def _existing_personal_root(env, user: str) -> str | None:
    """The user's Personal Root, without creating one (§14.8).

    Active first, the way `_core/roots.py` resolves an identity, then any
    Personal Root at all: an offboarded user's root is Archived, and their
    stored quota still belongs on it.
    """
    target = env.content_target
    found = target.active_roots(user)
    if not found:
        found = target.personal_roots(user)
    if not found:
        return None
    metadata = target.root_metadata(found[0])
    if not metadata or metadata.get("kind") != PERSONAL or metadata.get("user") != user:
        raise BuildSettingsError(
            f"Drive Root {found[0]!r} was read as {user}'s Personal Root but names "
            f"{metadata.get('user') if metadata else None!r}."
        )
    if metadata.get("state") not in (ACTIVE, ARCHIVED):
        raise BuildSettingsError(f"Drive Root {found[0]!r} has invalid state {metadata.get('state')!r}.")
    return found[0]


def _ports(env):
    if env.settings is None or env.settings_target is None:
        raise BuildSettingsError("Build settings ports are not configured")
    if env.content_target is None:
        raise BuildSettingsError("Build content ports are not configured")
    return env.settings, env.settings_target
