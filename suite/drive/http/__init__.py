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

Four rules hold across every route.

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
"""
