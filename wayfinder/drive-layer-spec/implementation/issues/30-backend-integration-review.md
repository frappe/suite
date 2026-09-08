# 30 — Verify the complete backend before migration rehearsal

**What to build:** Produce one verified integration state across storage, Drive, all content apps, HTTP, and WebDAV.

**Blocked by:** [05 — Preserve File adoption hooks on storage v2 uploads](05-file-upload-hook.md); [29 — Complete Build records, accounting, and reporting](29-build-records-and-report.md)

**Status:** in-progress

**Owner:** Suite integration. Claimed 2026-09-08 by three independent Claude
review agents on `integrate/drive-30-backend-review`, forked from
`forge/drive-layer` at `1d3001a03` (Suite) and `forge/storage-v2` at
`3357ad1605` (Frappe). Split into three non-overlapping review branches so
each reviewer covers a disjoint file set. Each branch reports findings and
fixes back onto `integrate/drive-30-backend-review`, which merges into
`forge/drive-layer` only. This ticket work never merges into `main`.

- **Review A — storage/framework** (spec §2–6, tickets 02–06, 05). Frappe repo,
  `forge/storage-v2`: `frappe/storage/` (`blob.py`, `gc.py`, `upload.py`,
  `serve.py`, `relocate.py`, `driver.py`, `local_driver.py`, `s3_driver.py`,
  `backfill.py`, `email.py`, `url.py`) and `frappe/storage/tests/`.
- **Review B — Drive core/concurrency** (spec §7–15, tickets 07–15). Suite
  repo: `suite/drive/_core/`, `suite/drive/doctype/` (root, node, grant,
  permission, storage_reservation, node_version, node_preview, comment*,
  favourite, recent, token, dav_lock, dav_property), `suite/drive/locks/`,
  `suite/drive/jobs.py`, `suite/drive/framework.py`, and their tests.
- **Review C — content+HTTP+WebDAV/deployment** (spec §16–14.9, tickets
  16–29). Suite repo: `suite/drive/http/`, `suite/drive/webdav/`,
  `suite/drive/api/`, `suite/drive/e2e_api.py`, `suite/drive/patches/`
  (including `build/`), `suite/drive/install.py`, content-contract call
  sites in `suite/writer/`, `suite/slides/`, `suite/sheets/`, and their
  tests.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §1–14; plan stage 8.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Check every normative spec section against implementation and ticket evidence. Close missing behavior before marking done.
- [ ] Review grants, link transport, upload bindings, byte egress, query filters, Guest identity, and all HTTP/DAV mutation paths.
- [ ] Test failure atomicity and concurrency for root pairs, quota admission, replacement, moves, and purge.
- [ ] Run the full storage package, Suite app suite, app adapter tests, architecture checks, and DAV acceptance.
- [ ] Rerun measurements only when relevant changes affect them. Record actual MariaDB schema and performance results.
- [ ] Confirm all four Drive Blob Link columns protect bytes and exactly five daily jobs are wired.
- [ ] Inspect the additive deployment path. Retain legacy data required for rollback and client adoption.
- [ ] Record exact code revisions, failures fixed, remaining external gates, and reproducible test commands.

## Verification

Run integration checks serially on slides.localhost. Attach actual output summaries and failure fixes; fixture tests do not count as a real export rehearsal.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
