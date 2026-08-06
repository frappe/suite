import shutil
from collections import Counter

import frappe

from suite.drive.utils import (
    GENERAL_USER,
    GROUP_PREFIX,
    PERMISSION_TYPES,
    STATUS_ACTIVE,
    STATUS_TRASHED,
    _deny_general_read,
    drop_previous_teams_if_empty,
    get_new_file_name,
    get_previous_teams_folder,
    get_root_folder,
    get_users_folder,
    grant_owner_access,
)
from suite.drive.utils.files import TRASH_PREFIX, FileManager, storage_key


def execute():
    """Collapse Drive Teams into Drive's tree.

    Files are not moved: storage stays flat and every existing file_url keeps
    working. Only thumbnails and trashed blobs move, because their location is
    computed from the root rather than stored, and the root has changed.
    """
    # Both are captured before the collapse rewrites the homes and before
    # drop_team_doctypes discards `team`; the sweep runs later and cannot re-derive
    # either, so they travel with the job.
    sidecars = _team_prefixes()
    trashed = _trashed_by_team()
    if frappe.db.exists("DocType", "Drive Team"):
        _collapse_teams()

    if not sidecars:
        return
    # Enqueued, not inline: this is thousands of S3 round trips and the tree is
    # already correct without it — only thumbnails and trashed blobs are waiting.
    frappe.enqueue(
        "suite.drive.patches.remove_teams.sweep_sidecars",
        queue="long",
        timeout=4 * 60 * 60,
        sidecars=sidecars,
        trashed=trashed,
    )
    print(f"Drive: queued the sidecar sweep for {len(sidecars)} old prefix(es)")


def _remember_route(team, entity):
    """Old links point at /drive/t/<team>, and the team id dies with the doctype.
    Keep the mapping so those links can still be resolved."""
    if frappe.db.exists("Drive Legacy Route", team):
        return
    frappe.get_doc({"doctype": "Drive Legacy Route", "old_id": team, "entity": entity}).insert(
        ignore_permissions=True
    )


def _trashed_by_team():
    """{team: {file_name: id}} — trashed blobs were keyed by name, per team."""
    if not frappe.db.has_column("File", "team"):
        return {}
    out = {}
    for row in frappe.get_all(
        "File",
        filters={"status": STATUS_TRASHED},
        fields=["name", "file_name", "team"],
        limit_page_length=0,
    ):
        out.setdefault(row.team, {})[row.file_name] = row.name
    return out


def _team_prefixes():
    """{team: old storage prefix}, while the team homes are still folder-less."""
    if not frappe.db.has_column("File", "team"):
        return {}
    rows = frappe.get_all(
        "File",
        filters={"folder": ("is", "not set"), "team": ("is", "set")},
        fields=["team", "file_url"],
        limit_page_length=0,
    )
    return {r.team: storage_key(r.file_url).rstrip("/") for r in rows if r.file_url}


def _collapse_teams():
    """Personal team roots become user folders under `Users`; the rest move into
    `Drive/Previous Teams`, membership rewritten as Drive Permission rows.

    `Users` carries no grant, so user folders are private. `Previous Teams` inherits
    `Drive`'s $GENERAL read, so each migrated team gets a $GENERAL deny and is
    reachable only by its old members. A public team keeps $GENERAL read."""
    # Created on the first team that needs it: a site with nothing but personal
    # teams shouldn't end up with an empty container in everyone's listing.
    previous_teams = None
    roots = {get_root_folder().name, get_users_folder().name}
    groups = {}

    teams = frappe.get_all("Drive Team", fields=["name", "title", "owner", "personal", "public", "quota"])
    print(f"Drive: collapsing {len(teams)} team(s)")
    for done, team in enumerate(teams, 1):
        if done % 100 == 0:
            print(f"  {done}/{len(teams)}")
        home = frappe.db.get_value("File", {"team": team.name, "folder": ("is", "not set")}, "name")
        if not home or home in roots:
            continue
        _remember_route(team.name, home)
        members = frappe.get_all(
            "Drive Team Member",
            filters={"parenttype": "Drive Team", "parent": team.name},
            fields=["user", "access_level"],
        )
        # Nothing matches a deleted user, and `Drive Settings.user` is a Link — a user
        # folder for one aborts the migration.
        members = [m for m in members if m.user and m.user != team.owner]
        members = [m for m in members if frappe.db.exists("User", m.user)]
        owned = bool(team.owner) and frappe.db.exists("User", team.owner)

        if team.personal and owned and not frappe.db.get_value("Drive Settings", team.owner, "user_folder"):
            _to_user_folder(home, team)
            _grant_members(home, members)
            continue

        previous_teams = previous_teams or get_previous_teams_folder()
        _to_shared_folder(previous_teams, home, team, owned)
        # own row too, so it stays private if moved out of `Previous Teams`
        if team.public:
            _grant(home, GENERAL_USER, {"read": 1})
        else:
            _deny_general_read(home)

        # A team was a group of people, so it becomes one: members are granted
        # through a User Group, not fanned out per user. Keeps one row where the
        # team had one, and later membership changes still apply.
        team_groups = _user_groups_for(team, members)
        if team_groups:
            groups[team.name] = team_groups[0]
            _grant_group(home, team_groups)
            # Also on the container, or the folder is readable but unreachable: the
            # $GENERAL deny there hides it from the listing, so members would have no
            # way to browse to their own team. A group row outranks $GENERAL on the
            # same node, and listing filters children by read, so each person sees
            # only the teams they were in.
            _grant(previous_teams.name, GROUP_PREFIX + team_groups[0], {"read": 1})
        else:
            _grant_members(home, members)

    _expand_team_rows(groups)
    _drop_obsolete_revoke_rows()
    # A rerun, or an earlier run that made the container before this was lazy
    drop_previous_teams_if_empty()


LEVEL_LABEL = {0: "", 1: " (Members)", 2: " (Managers)"}


def _user_groups_for(team, members):
    """`User Group`s mirroring the team: one holding everyone, plus one per higher
    access level. Returns {access_level: group name}, empty when nobody is left.

    The all-members group is what a `team=1` permission row resolves to, since such
    a row granted the whole team at its own access level.
    """
    everyone = {m.user for m in members}
    if team.owner and frappe.db.exists("User", team.owner):
        everyone.add(team.owner)
    if not everyone:
        return {}

    buckets = {0: sorted(everyone)}
    for level in (1, 2):
        at_level = sorted(m.user for m in members if (m.access_level or 0) >= level)
        if at_level:
            buckets[level] = at_level

    title = team.title or team.name
    out = {}
    for level, users in buckets.items():
        name = get_new_group_name(title + LEVEL_LABEL[level])
        group = frappe.get_doc({"doctype": "User Group", "__newname": name})
        for user in users:
            group.append("user_group_members", {"user": user})
        group.insert(ignore_permissions=True)
        out[level] = group.name
    return out


def get_new_group_name(title):
    """User Group names are the primary key, so a title collision needs a suffix."""
    base = (title or "Team").strip()[:100] or "Team"
    if not frappe.db.exists("User Group", base):
        return base
    for n in range(1, 1000):
        candidate = f"{base} ({n})"
        if not frappe.db.exists("User Group", candidate):
            return candidate
    return f"{base} {frappe.generate_hash(length=6)}"


def _grant_group(entity, groups):
    """One row per access level, never per member — the Frappe team is 114 people,
    and a row each would put 114 rows on every entity it can reach.

    Grants at different levels overlap by design: a manager sits in both the
    all-members group and the managers group, and resolution takes the union of
    same-tier group rows, so the wider grant wins per permission type.
    """
    for level, group in groups.items():
        _grant(entity, GROUP_PREFIX + group, _access_for(level))


def _access_for(access_level):
    if not access_level:
        return {"read": 1}
    perms = {"read": 1, "comment": 1, "upload": 1}
    if access_level == 2:
        perms.update({"write": 1, "share": 1})
    return perms


def _to_user_folder(home, team):
    frappe.db.set_value(
        "File",
        home,
        {"folder": get_users_folder().name, "file_name": team.owner, "owner": team.owner},
        update_modified=False,
    )
    grant_owner_access(home, team.owner)

    if not frappe.db.exists("Drive Settings", team.owner):
        frappe.get_doc({"doctype": "Drive Settings", "user": team.owner}).insert(ignore_permissions=True)
    frappe.db.set_value(
        "Drive Settings",
        team.owner,
        {"user_folder": home, "quota": team.quota or 0},
        update_modified=False,
    )


def _to_shared_folder(root, home, team, owned):
    values = {
        "folder": root.name,
        "file_name": get_new_file_name(team.title or team.name, root.name),
        "is_folder": 1,
        "file_type": "Folder",
        "status": STATUS_ACTIVE,
    }
    if owned:
        values["owner"] = team.owner
    frappe.db.set_value("File", home, values, update_modified=False)
    if owned:
        grant_owner_access(home, team.owner)


def _grant_members(entity, members):
    for m in members:
        if frappe.db.exists("Drive Permission", {"entity": entity, "user": m.user}):
            continue
        perms = (
            {"read": 1}
            if not m.access_level
            else {
                "read": 1,
                "comment": 1,
                "upload": 1,
                **({"write": 1, "share": 1} if m.access_level == 2 else {}),
            }
        )
        frappe.get_doc({"doctype": "Drive Permission", "entity": entity, "user": m.user, **perms}).insert(
            ignore_permissions=True
        )


def _grant(entity, user, perms):
    if frappe.db.exists("Drive Permission", {"entity": entity, "user": user}):
        return
    frappe.get_doc({"doctype": "Drive Permission", "entity": entity, "user": user, **perms}).insert(
        ignore_permissions=True
    )


def _expand_team_rows(groups):
    """team=1 rows granted the row's team (stored in `user`) access to an entity.
    The team now has a User Group, so one group row replaces what would otherwise
    be a row per member — a 114-member team fanned out to 114 rows per entity.
    All-zero team rows were revoke attempts, which nothing grants any more."""
    for row in frappe.get_all("Drive Permission", filters={"team": 1}, fields=["*"]):
        perms = {t: row.get(t) or 0 for t in PERMISSION_TYPES}
        if not any(perms.values()):
            continue
        group = groups.get(row.user)
        if group:
            _grant(row.entity, GROUP_PREFIX + group, perms)
            continue
        # a personal team, or one with nobody left in it: no group to grant through
        for m in frappe.get_all(
            "Drive Team Member",
            filters={"parenttype": "Drive Team", "parent": row.user},
            fields=["user"],
        ):
            if m.user and frappe.db.exists("User", m.user):
                _grant(row.entity, m.user, perms)
    # nothing links to a Drive Permission, and it has no delete-time logic
    frappe.db.delete("Drive Permission", {"team": 1})


def _drop_obsolete_revoke_rows():
    """Link rows granting nothing were revoke attempts; nothing grants that way now."""
    frappe.db.delete("Drive Permission", {"user": "", "deny": 0, **dict.fromkeys(PERMISSION_TYPES, 0)})


def sweep_sidecars(sidecars=None, trashed=None):
    """Move thumbnails and trashed blobs onto the new root.

    Both are located from the root rather than stored — `<root>/thumbnails/<id>` and
    `<root>/.trash/<id>` — and the root moved from each team's own prefix to Drive's,
    so the objects have to follow or they are simply not found.

    Runs as a job; safe to re-run by hand if it failed:

        bench --site <site> execute suite.drive.patches.remove_teams.sweep_sidecars

    With no arguments it re-derives the prefixes, which only works while `team` is
    still on File. Idempotent either way: anything already at the destination is
    skipped and the originals are left alone.
    """
    sidecars = sidecars or _team_prefixes()
    trashed = trashed or _trashed_by_team()
    if not sidecars:
        print("Drive: no old prefixes to sweep")
        return
    try:
        moved, failed = _carry_sidecars(sidecars, trashed)
    except Exception as e:
        print(f"Drive: could not reach storage, sidecars not moved ({type(e).__name__}: {e})")
        raise

    for kind, n in sorted(moved.items()):
        print(f"Drive: moved {n} {kind}")
    for key, reason in failed[:20]:
        print(f"Drive: could not move {key}: {reason}")
    if len(failed) > 20:
        print(f"Drive: ... and {len(failed) - 20} more")


def _carry_sidecars(sidecars, trashed):
    manager = FileManager()
    root = manager.get_root_storage_key().rstrip("/")
    prefix = manager.settings.thumbnail_prefix or "thumbnails"

    # One listing, not one per prefix and a head_object per object: on S3 that is
    # ~10 paginated calls instead of thousands of round trips.
    existing = _all_keys(manager, sidecars, root, prefix)

    moved, failed = Counter(), []
    for team, base in sidecars.items():
        if not base or base == root:
            continue
        for key in existing.get(f"{base}/{prefix}", ()):
            name = key.rsplit("/", 1)[-1]
            dest = f"{root}/{prefix}/{name}"
            if name and dest not in existing.get(f"{root}/{prefix}", ()):
                _carry(manager, key, dest, moved, failed)
        for key in existing.get(f"{base}/{TRASH_PREFIX}", ()):
            entity = trashed.get(team, {}).get(key.rsplit("/", 1)[-1])
            dest = f"{root}/{TRASH_PREFIX}/{entity}"
            if entity and dest not in existing.get(f"{root}/{TRASH_PREFIX}", ()):
                _carry(manager, key, dest, moved, failed)
    return moved, failed


def _all_keys(manager, sidecars, root, prefix):
    """{directory: {keys}} for every sidecar directory we care about."""
    wanted = {f"{root}/{prefix}", f"{root}/{TRASH_PREFIX}"}
    for base in sidecars.values():
        if base:
            wanted |= {f"{base}/{prefix}", f"{base}/{TRASH_PREFIX}"}

    out = {}
    if manager.s3_enabled:
        token = None
        while True:
            kwargs = {"Bucket": manager.bucket}
            if token:
                kwargs["ContinuationToken"] = token
            page = manager.conn.list_objects_v2(**kwargs)
            for o in page.get("Contents", []):
                key = o["Key"]
                parent = key.rsplit("/", 1)[0] if "/" in key else ""
                if parent in wanted:
                    out.setdefault(parent, set()).add(key)
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")
        return out

    for directory in wanted:
        folder = _local(manager, directory)
        if folder.is_dir():
            out[directory] = {f"{directory}/{f.name}" for f in folder.iterdir() if f.is_file()}
    return out


def _carry(manager, src, dest, moved, failed):
    """The caller has already checked the destination against the listing, so this
    does not probe storage again — that probe was the bulk of the round trips."""
    kind = "trashed blob(s)" if TRASH_PREFIX in dest else "thumbnail(s)"
    if src == dest:
        return
    try:
        _copy(manager, src, dest)
        moved[kind] += 1
    except Exception as e:
        failed.append((src, f"{type(e).__name__}: {e}"))


def _local(manager, key):
    """Upgraded sites store `?path=/<team>/<id>`, and `base / "/abs"` discards
    `base` — strip it so a local path can't escape the site folder."""
    return manager.site_folder / key.lstrip("/")


def _copy(manager, src, dest):
    if manager.s3_enabled:
        manager.conn.copy_object(
            Bucket=manager.bucket, CopySource={"Bucket": manager.bucket, "Key": src}, Key=dest
        )
        if _size(manager, dest) != _size(manager, src):
            raise OSError(f"copy of {src} did not verify")
    else:
        src_path = _local(manager, src)
        dest_path = _local(manager, dest)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dest_path)
        if dest_path.stat().st_size != src_path.stat().st_size:
            raise OSError(f"copy of {src} did not verify")


def _size(manager, key):
    return manager.conn.head_object(Bucket=manager.bucket, Key=key)["ContentLength"]
