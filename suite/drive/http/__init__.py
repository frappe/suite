"""Drive's HTTP surface: real routes under `/api/suite/drive/`.

Three modules, one job each.

- `translator` is the `before_request` hook. It rewrites a Drive path onto
  Frappe's v2 method URL and does nothing else. Authentication, the session,
  the `{"data": ...}` envelope, and the `{"errors": [...]}` envelope stay
  Frappe's, so Drive never re-implements them (§11.1).
- `routes` holds one whitelisted handler per row of §11.2. A handler declares
  its verb and whether a guest may reach it, builds the caller's principals
  once, calls one private Drive workflow, and shapes the answer. It parses
  nothing else and it decides no policy.
- `shapes` turns a stored row into §11.3's node shape and coerces the strings
  a query string delivers into the types a workflow expects.

Seven rules hold across every route.

**The path wins.** The translator writes each path segment into `form_dict`
after Frappe parsed the body, so `POST /nodes/a1/copy` acts on `a1` even when
the body says otherwise. `cmd` is removed at the same moment, because
`frappe/app.py` dispatches a request carrying `cmd` through `frappe.handler`
*before* it looks at the `/api/` prefix: a `cmd` left in place would run a
method of the caller's choosing instead of the route they addressed.

**Bytes are never a client argument.** No route accepts a blob id, a blob key,
a preview id, or a byte count. A file is created and replaced through an upload
session, which proves the caller produced the bytes; every URL that lets bytes
out is minted after a `require` on the node that owns them.

**A refusal keeps its class.** Every workflow raises a `DriveError` subclass
carrying its status. The boundary re-throws it so the v2 envelope carries the
class name and the message together, and maps a plain `frappe.ValidationError`
- a malformed argument - onto `DriveError`, which is 400.

**A guest is a principal, not an exception.** `allow_guest` only decides
whether a route is reachable without a session. Who may act is decided by
`_core.access.require`, from the caller's principals and this request's
`X-Drive-Links` header.

**Times are UTC on the wire.** Every time a route publishes is RFC 3339 with
a `Z` (`shapes.stamp`), and every time a route accepts must carry its offset
(`shapes.moment`); a naive one is a 400, because the sender does not know the
site's zone the columns are stored in. `_core/times.py` owns both conversions
(§11.3).

**A write answers the thing it changed, or a count.** A write that creates or
changes one resource answers that resource's shape: a node, a grant, a
version, a thread, a comment. A write that removes or touches rows answers
`shapes.Count`: every DELETE, a purge, a visit, a star, a read receipt. No
route answers an empty object or an ad hoc key.

**Every row declares what travels.** A `Route` in `translator` names its
`body` (every POST, PUT and PATCH; `shapes.Empty` when nothing is sent), its
`query` (a GET or DELETE that takes arguments), its `output`, and the
refusals it may answer; a row whose bytes are not JSON is `stream=True`. The
common trio - `DriveNotFound`, `DriveLocked`, `DriveLinkExpired` - is put
first on every `nodes/{node}` row by the translator, so a row lists only its
extras. The frontend contract is generated from these declarations, so a
handler parameter the row does not declare is a test failure, not a hidden
argument (§11.2).
"""
