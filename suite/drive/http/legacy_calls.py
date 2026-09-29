"""The legacy-call counter: who still calls the 69 names of §11.7.

Every request that addresses a name in `shims.CLASSIFICATION` is counted by
that name and the caller's user agent, however Frappe dispatches it: a dotted
path on `/api/method/` (any API version, or the old `cmd` form), or one of the
three `File` document methods through `run_doc_method`, `/api/resource/File`,
or `/api/v2/document/File`. A refused call counts too: the caller exists.

The request only buffers its call in Redis, one pipelined round trip.
`flush` moves the buffer into `Drive Legacy Call` rows, which survive a
migrate, a deploy, and a cache flush; the scheduler runs it every tick, and the
`drive-legacy-calls` bench command runs it before it reads. Counts are
cumulative and never reset: the hold compares two reads (§14.10 gate 3).

Cleanup deletes this module, the doctype, and the command with the names.
"""

import hashlib
import json

import frappe
from frappe.app import canonical_request_path
from frappe.utils import now

from suite.drive.doctype.drive_legacy_call.drive_legacy_call import FLUSH_FLAG

DOCTYPE = "Drive Legacy Call"
USER_AGENT_LENGTH = 255
# Distinct user agents kept per name. Later ones share the `OTHER_AGENT` row,
# so a client that rotates its user agent grows neither Redis nor the table,
# and every call is still counted.
AGENT_CAP = 50
OTHER_AGENT = "(other)"

# The buffer is three Redis hashes keyed by `_field(name, agent)`. A flush
# renames them to the in-flight keys, stores them, commits, and only then
# deletes the in-flight keys, so a flush that dies before its commit leaves its
# batch for the next one. The worst case is a count stored twice, never lost.
BUFFER_KEYS = ("drive:legacy-calls:count", "drive:legacy-calls:first", "drive:legacy-calls:last")
IN_FLIGHT_KEYS = tuple(f"{key}:in-flight" for key in BUFFER_KEYS)
AGENTS_KEY = "drive:legacy-calls:agents:"
LOCK_KEY = "drive:legacy-calls:lock"
# A flush holds the lock at most this long, so a dead worker cannot hold it.
LOCK_SECONDS = 300

# Frappe's RPC names for "run a method on this document".
DOC_METHOD_RUNNERS = frozenset(
    {"run_doc_method", "runserverobj", "frappe.handler.run_doc_method", "frappe.handler.runserverobj"}
)
# `/api/resource/File/<name>` (v1, `run_method`), `/api/v2/document/File/<name>/method/<m>`
# and `/api/v2/method/run_doc_method` run the method only for these verbs.
# PUT and DELETE on the same path update or delete the document instead.
DOC_METHOD_VERBS = frozenset({"GET", "HEAD", "POST", "QUERY"})
DOTTED_PREFIX = "suite.drive."
FILE_METHOD_PREFIX = "overrides.file.File."
# A request whose path and `cmd` hold none of these cannot name a legacy call,
# so it leaves before the shim table is imported.
CANDIDATE_MARKERS = (DOTTED_PREFIX, "run_doc_method", "runserverobj", "/File/")


# --------------------------------------------------------------------------
# Recognising a legacy call
# --------------------------------------------------------------------------


def legacy_name(verb: str, path: str, form: dict) -> str | None:
    """Return the `CLASSIFICATION` name a request addresses, or None.

    OPTIONS never counts: Frappe answers a preflight before any dispatch.
    """
    cmd = form.get("cmd")
    if verb == "OPTIONS" or not any(marker in (cmd or path) for marker in CANDIDATE_MARKERS):
        return None
    if cmd:
        return _rpc_name(str(cmd), verb, v2=False, form=form)

    v2 = path.startswith("/api/v2/")
    path = canonical_request_path(path)
    if path.startswith("/api/method/"):
        method = path.removeprefix("/api/method/").split("/")[0]
        return _rpc_name(method, verb, v2=v2, form=form)
    if verb not in DOC_METHOD_VERBS:
        return None
    if path.startswith("/api/resource/File/"):
        return _file_method(form.get("run_method"))
    if path.startswith("/api/document/File/") and "/method/" in path:
        return _file_method(path.rstrip("/").rsplit("/method/", 1)[1])
    return None


def _rpc_name(method: str, verb: str, *, v2: bool, form: dict) -> str | None:
    if method in DOC_METHOD_RUNNERS:
        # v1 runs the method whatever the verb; v2 mounts it for DOC_METHOD_VERBS only.
        if v2 and verb not in DOC_METHOD_VERBS:
            return None
        return _file_method(form.get("method")) if _document_type(form) == "File" else None
    if method.startswith(DOTTED_PREFIX):
        name = method.removeprefix(DOTTED_PREFIX)
        return name if name in _classified() else None
    return None


def _classified():
    from suite.drive.http.shims import CLASSIFICATION

    return CLASSIFICATION


def _document_type(form: dict) -> str | None:
    """The doctype a `run_doc_method` call names, in either API version's spelling."""
    if dt := form.get("dt"):
        return dt
    document = form.get("docs") or form.get("document")
    if isinstance(document, str):
        document = json.loads(document)
    return document.get("doctype") if isinstance(document, dict) else None


def _file_method(method) -> str | None:
    name = f"{FILE_METHOD_PREFIX}{method}"
    return name if name in _classified() else None


# --------------------------------------------------------------------------
# The buffer
# --------------------------------------------------------------------------

# One round trip, atomic: pick the agent (or `OTHER_AGENT` past the cap), then
# add the call to the three buffer hashes.
_RECORD = r"""
local agent = ARGV[2]
if redis.call('SISMEMBER', KEYS[4], agent) == 0 then
  if redis.call('SCARD', KEYS[4]) < tonumber(ARGV[4]) then
    redis.call('SADD', KEYS[4], agent)
  else
    agent = ARGV[5]
  end
end
local field = ARGV[1] .. '\n' .. agent
redis.call('HINCRBY', KEYS[1], field, 1)
redis.call('HSETNX', KEYS[2], field, ARGV[3])
redis.call('HSET', KEYS[3], field, ARGV[3])
return 1
"""

# Atomic hand-off. 1: an in-flight batch is left over, store it first.
# 2: the buffer is now in flight. 0: nothing to store.
_HAND_OFF = """
if redis.call('EXISTS', KEYS[4]) == 1 then return 1 end
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
for i = 1, 3 do
  if redis.call('EXISTS', KEYS[i]) == 1 then redis.call('RENAME', KEYS[i], KEYS[i + 3]) end
end
return 2
"""


def _field(name: str, agent: str) -> str:
    return f"{name}\n{agent}"


def _key(key: str) -> str:
    return frappe.cache.make_key(key)


def _agents_key(name: str) -> str:
    return _key(AGENTS_KEY + name)


def _lock():
    """The one lock every flush, and every read after a flush, holds."""
    return frappe.cache.lock(
        _key(LOCK_KEY), timeout=LOCK_SECONDS, blocking_timeout=LOCK_SECONDS, thread_local=False
    )


def record(request) -> None:
    """Buffer one call if `request` addresses a legacy name.

    Never raises: a counter fault must not refuse the call it counts.
    """
    try:
        name = legacy_name(request.method, request.path, frappe.form_dict)
        if name:
            _buffer(name, (request.headers.get("User-Agent") or "")[:USER_AGENT_LENGTH])
    except Exception:
        try:
            frappe.log_error(title="Drive: could not count a legacy call")
        except Exception:
            pass


def _buffer(name: str, agent: str) -> None:
    keys = [_key(key) for key in BUFFER_KEYS] + [_agents_key(name)]
    frappe.cache.eval(_RECORD, len(keys), *keys, name, agent, now(), AGENT_CAP, OTHER_AGENT)


def flush() -> int:
    """Store the buffered calls in `Drive Legacy Call` rows and commit. Return the rows touched."""
    with _lock():
        return _flush_locked()


def _flush_locked() -> int:
    keys = [_key(key) for key in BUFFER_KEYS + IN_FLIGHT_KEYS]
    stored = 0
    while state := frappe.cache.eval(_HAND_OFF, len(keys), *keys):
        stored += _store_in_flight(keys[3:])
        if state == 2:
            break
    return stored


def _store_in_flight(in_flight: list[str]) -> int:
    pipe = frappe.cache.pipeline(transaction=True)
    for key in in_flight:
        pipe.hgetall(key)
    counts, firsts, lasts = pipe.execute()
    now_seen = now()
    for field, count in counts.items():
        name, agent = field.decode().split("\n", 1)
        # A hash lost to eviction leaves no time; the flush time stands in.
        first_seen = (firsts.get(field) or now_seen.encode()).decode()
        last_seen = (lasts.get(field) or now_seen.encode()).decode()
        _store(name, agent, int(count), first_seen, last_seen)
    frappe.db.commit()
    frappe.cache.delete(*in_flight)
    return len(counts)


def _row_name(name: str, agent: str) -> str:
    """One row per (name, user agent), so a flush finds its row without a query."""
    return hashlib.sha1(json.dumps([name, agent]).encode()).hexdigest()


def _store(name: str, agent: str, count: int, first_seen: str, last_seen: str) -> None:
    """Add one buffered tally to its row, creating the row on its first call.

    The table holds the agent cap too, so a Redis that forgot which agents it
    saw still cannot grow it.
    """
    row = _row_name(name, agent)
    if not frappe.db.exists(DOCTYPE, row):
        if agent != OTHER_AGENT and (
            frappe.db.count(DOCTYPE, {"legacy_name": name, "user_agent": ["!=", OTHER_AGENT]}) >= AGENT_CAP
        ):
            return _store(name, OTHER_AGENT, count, first_seen, last_seen)
        doc = frappe.get_doc(
            {
                "doctype": DOCTYPE,
                "legacy_name": name,
                "user_agent": agent,
                "count": count,
                "first_seen": first_seen,
                "last_seen": last_seen,
            }
        )
        frappe.flags[FLUSH_FLAG] = True
        try:
            doc.insert(ignore_permissions=True, set_name=row)
        finally:
            frappe.flags[FLUSH_FLAG] = False
        return
    frappe.db.sql(
        """update `tabDrive Legacy Call`
        set `count` = `count` + %(count)s,
            first_seen = least(first_seen, %(first_seen)s),
            last_seen = greatest(last_seen, %(last_seen)s)
        where name = %(row)s""",
        {"count": count, "first_seen": first_seen, "last_seen": last_seen, "row": row},
    )


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------

COLUMNS = ("legacy_name", "user_agent", "count", "first_seen", "last_seen")


def rows() -> list[dict]:
    """Every stored row, the latest call first.

    It flushes and reads under the flush lock, so a batch another flush holds
    in flight is either committed before the read or stored by this flush.
    """
    with _lock():
        _flush_locked()
        return frappe.get_all(DOCTYPE, fields=list(COLUMNS), order_by="last_seen desc, legacy_name asc")


def report(*, as_json: bool = False) -> str:
    """The `drive-legacy-calls` output: one line per row, then the total."""
    found = rows()
    calls = sum(row["count"] for row in found)
    names = len({row["legacy_name"] for row in found})
    if as_json:
        return frappe.as_json({"rows": found, "total": {"calls": calls, "names": names}}, indent=1)
    lines = ["\t".join(("name", "user agent", "count", "first seen", "last seen"))]
    lines += ["\t".join(str(row[column]) for column in COLUMNS) for row in found]
    lines.append(f"total: {calls} calls over {names} names")
    return "\n".join(lines)
