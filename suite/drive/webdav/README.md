# Drive WebDAV Server

Status: current-server operations plus the accepted rewrite target. The target
behavior is authoritative in
[`../../../wayfinder/drive-layer-spec/drive-layer-spec.md`](../../../wayfinder/drive-layer-spec/drive-layer-spec.md)
§12, and its module boundaries come from
[`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md).

A first-class WebDAV server (RFC 4918 Class 1, 2, 3 — full litmus compliance)
built into Drive. Any WebDAV client — Windows Explorer, macOS Finder, Linux
GVFS/KDE, Cyberduck, rclone, mobile file apps, MS Office — manages Drive files
directly at `https://<site>/dav/`.

## Enabling

1. **Admin**: Drive → Settings → WebDAV → *Enable WebDAV* (or check
   *Enable WebDAV* on the **Drive Disk Settings** doctype).
2. **User**: turn on *Allow WebDAV Access* under Drive → Settings → WebDAV
   (off by default), then connect a client to `https://<site>/dav/` and sign
   in with the Frappe username and password.

The shipped server currently shows two folders: **Home** (the user's personal
files) and **Everyone** (the shared site tree). This is current behavior, not
the rewrite target.

## Rewrite target

- `/dav/` mounts the caller's Personal Root directly. It does not expose a
  Shared Root or a “shared with me” mount.
- The same Drive roles apply in WebDAV and the web app. A DAV session never
  carries a Share Link principal.
- Content Documents appear as read-only exports when their Content Type has a
  default export; they remain leaves and their media children are not listed.
- HTTP and WebDAV call the same private Drive workflows in
  `suite/drive/_core/`. WebDAV owns protocol translation, not permission,
  quota, activity, or node policy.
- `perms.py` is deleted. Folder pages use the Drive engine's batched access
  resolution. Direct storage-manager calls and the staging machinery in
  `put.py` are replaced by the node/upload workflows and `frappe.storage`.

Notes on behavior:

- **Method allow-list**: *Allowed WebDAV Methods* on Drive Disk Settings
  restricts which verbs clients may use (empty = all). Input is validated
  against the supported set; OPTIONS is always allowed and GET implies HEAD.
  `PROPFIND, GET` gives site-wide read-only WebDAV — the OPTIONS handshake
  then advertises `DAV: 1, 3` (no locking) so clients degrade gracefully.
- **DELETE moves to Drive's trash** — recoverable from the web UI for 30 days.
- Clients sign in with the Frappe username and password, **or with an API
  key and secret** in their place (generated from the WebDAV settings panel;
  the secret is shown once). API credentials are their own factor, so they are
  the working path for **two-factor accounts** — and for social-login accounts
  without a site password — whose passwords cannot complete Basic auth.
- ETags are strong (`sha256` of content, populated on every WebDAV write).
- Locks (`LOCK`/`UNLOCK`, exclusive + shared, depth 0/infinity, Office-style
  refresh) coordinate DAV clients with each other; the Drive web UI is not
  blocked by DAV locks. Administrators can force-unlock a stuck document by
  deleting its **Drive DAV Lock** row (or via UNLOCK).

## Current implementation architecture

The dispatcher (`dispatch.py`) is a `before_request` hook — the only point in
the Frappe request lifecycle that sees WebDAV verbs — and answers `/dav/*`
end to end, returning responses by raising an `HTTPException` carrier that
`frappe.app` returns verbatim. Basic credentials are verified with frappe's
own `check_password` (an HMAC cache bound to the stored hash keeps the hot
path fast; a password change invalidates instantly). Request bodies stream
when frappe supports the `streaming_request_paths` hook, and fall back to
frappe's buffered/capped body handling otherwise.

Module map: `auth` (Basic + lockout tracking), `pathmap` (URL ↔ entity,
naming policy), `perms` (batched Depth:1 permission resolution — constant
query count per listing), `propfind`/`proppatch` (+ `deadprops` store),
`get`/`put` (streamed content, Range, conditionals), `structure`
(MKCOL/DELETE/MOVE), `copy` (recursive COPY with quota checks), `locks` +
`ifheader` + `lock` (Class 2), `xmlutil` (hardened lxml + multistatus).

During the rewrite, protocol-focused modules remain under
`suite/drive/webdav/`; policy and state transitions move behind the private
Drive implementation described above. Code outside Drive must not import this
adapter.

## Deployment caveats (admin-facing; no end-user setup needed)

- **HTTPS is required for Windows**: the Windows WebClient refuses Basic auth
  over plain HTTP by default (registry `BasicAuthLevel`; do not recommend
  changing it). Windows also caps transfers client-side at ~47 MB
  (`FileSizeLimitInBytes`).
- **nginx trailing-slash rewrite**: the standard bench template 301s
  `PROPFIND /dav/folder/` → `/dav/folder`. The server accepts slashless
  collection URLs, and most clients follow the redirect; for Finder-heavy
  production sites add a `location /dav { try_files /dev/null @webserver; }`
  block to bypass the rewrite. Dev benches (`bench serve`) are unaffected.
- **Upload size**: with the frappe `streaming_request_paths` hook, PUT bodies
  stream with no framework cap — but production nginx's `client_max_body_size`
  (50m in the stock template) still bounds them; raise it (and consider
  `proxy_request_buffering off;`) for large files. On frappe versions without
  the hook, PUTs are buffered and capped at `max_file_size` (25 MB default).
- **Rate limiting**: the site-wide `rate_limit` config (off by default) is a
  CPU-time budget; a Finder tree walk is chatty — size the budget accordingly.
- Never create `sites/<site>/public/dav/` — nginx `try_files` would shadow
  the prefix. Very deep UTF-8 paths can exceed gunicorn's 4094-byte
  request-line default.
- On **Frappe Cloud**, `/dav` is in the app's `ALLOWED_WILDCARD_PATHS`.

## Site config keys

Optional per-site knobs (`site_config.json`):

| Key | Effect |
|---|---|
| `drive_webdav_log_level` | Request logging to `logs/suite.drive.webdav.log` (bench and site copy), **on by default at `info`** — one line per request (method, path, status, duration, user, IP, client). `"error"` = 5xx only, `"warning"` = adds 4xx, `"debug"` = adds the protocol headers (Depth, Destination, If, Lock-Token…), `"off"` = disabled. Credentials are never logged. |
| `drive_webdav_max_upload_size` | Absolute PUT body ceiling in bytes, enforced while spooling (on top of the per-user quota bound). |
| `drive_webdav_s3_redirect` | Serve S3-backed GETs as 302s to presigned URLs instead of proxying. Only for deployments whose clients handle cross-host redirects (rclone, Cyberduck — not the Windows mini-redirector). |

## rclone

```
rclone config create drive webdav \
    url=https://<site>/dav vendor=nextcloud user=<email> pass=<password>
```

Use `--webdav-nextcloud-chunk-size 0` (the chunked-upload protocol of the
nextcloud vendor is not implemented; the vendor is still worth selecting
because it round-trips modification times via `X-OC-Mtime`). Windows
Explorer's `Win32LastModifiedTime` PROPPATCH is honored too.

## Compliance testing

`tests/run_litmus.sh <site>` runs the full litmus suite (http, basic,
copymove, props, locks) against a throwaway user's Home and compares the
outcome with `tests/litmus_expected.txt` — CI fails on unledgered failures
and on stale ledger lines. Current status: **all 110 tests pass**; one
advisory warning is ledgered.

Python integration tests live beside the code:
`bench --site <site> run-tests --module suite.drive.webdav.tests.<module>`.

## Manual client checklist (run before release)

| Client | mount/auth | list 1k folder | open | save | rename | mkdir | delete→trash | lock visible/423 | unlock on close |
|---|---|---|---|---|---|---|---|---|
| Windows 11 Explorer (HTTPS) | | | | | | | | | |
| macOS Finder | | | | | | | | | |
| GNOME Files (GVFS) | | | | | | | | | |
| KDE Dolphin | | | | | | | | | |
| Cyberduck | | | | | | | | | |
| rclone (nextcloud vendor) | | | | | | | | | |
| Word via direct URL | | | | | | | | | |
| Documents by Readdle (iOS) | | | | | | | | | |
| Material Files (Android) | | | | | | | | | |
