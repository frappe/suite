# 40 — Make Cleanup delete every legacy Drive name and the allowlist prefix

**What to build:** Amend the prepared Cleanup (ticket 35) so that gate 3 and phase 6 cover all 69 legacy names, not the forwarder class only. Delete `suite/drive/api/product.py`, `suite/drive/api/s3.py`, and `suite/drive/overrides/file.py` with the rest, keep `Drive User Invitation` and `Account Request` with their rows but remove their permission hooks, and remove `/api/method/suite.drive.api.` from `ALLOWED_WILDCARD_PATHS`. Only `/dav` stays.

**Blocked by:** [35 — Implement Cleanup with refusal gates and fixture tests](35-cleanup-implementation.md); [39 — Expose Drive settings, site settings, and WebDAV access through HTTP](39-settings-and-webdav-routes.md)

**Status:** ready-for-agent

**Owner:** Suite migration

**Execution gate:** Preparation only, as ticket 35: fixture tests, patch stays unregistered and inactive. Activation stays with [36 — Activate Cleanup after the Build release and client migration](36-cleanup-later-release.md), whose "retain every permanent compatibility path" criterion now means `/dav` only.

**Raised by:** unified frontend ticket [017 — Product methods and the zero-call gate](../../../unified-frontend/tickets/017-product-methods-and-the-zero-call-gate.md). Faris: "i dont want to keep any dotted paths when suite is launched, update the spec and do whatever is necessary". The spec no longer has permanent `suite.drive.api.*` names: both earlier permanent names resolve through `File` rows Cleanup deletes (§11.7).

**Source:** [Drive spec](../../drive-layer-spec.md), §3.16, §11.7, §14.10.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Gate 3 (`suite/drive/patches/cleanup/gate.py`, `check_gate_legacy_callers_removed`) reads caller evidence for every name in `shims.CLASSIFICATION`, whatever its class. A hit on any name refuses Cleanup.
- [ ] `SiteClientCallerEvidence` scans `frontend/src` and `suite/public/js` (the Desk file picker, `FileUploader.vue`, calls three legacy names today). A missing tree still raises.
- [ ] Gate 3 also refuses while a Suite Python module outside `suite/drive/api` and `suite/drive/http` imports a body phase 6 deletes. Today's importers: `suite/writer/api/embed.py`, `suite/writer/api/docs.py`, `suite/writer/api/general.py`, `suite/writer/overrides/__init__.py`, `suite/writer/doctype/writer_document/writer_document.py`, `suite/sheets/doctype/sheet/sheet.py`, `suite/slides/doctype/presentation/presentation.py`, `suite/drive/utils/api.py`, `suite/drive/doctype/drive_permission/drive_permission.py`, and the `File` override and `after_file_upload` entries in `suite/hooks.py`. Retargeting them is not this ticket; refusing until they are gone is.
- [ ] Phase 6 (`removal.py`, `phase_legacy_api`) removes every name in `CLASSIFICATION` and the wildcard prefix. `SiteForwarderRegistry.remove` names the files that go: `suite/drive/http/shims.py`, every module under `suite/drive/api/`, `suite/drive/overrides/file.py`, and the `override_doctype_class["File"]` entry. The existing "only forwarder names are removed" test is inverted, not deleted.
- [ ] `after_request` (`suite/hooks.py:440`, the CSP `frame-ancestors` hook in `product.py`) has a home in `suite/drive/framework.py` before `product.py` can go. The hook string in `suite/hooks.py` is updated in the activation release.
- [ ] Phase 3 keeps `Drive User Invitation` and `Account Request` and their rows (Faris, 2026-09-29). It removes the two permission hooks (`suite/hooks.py:207`, `:251`); the doctypes fall back to their standard role permissions, and their controllers import no deleted module. `suite/drive/e2e_api.py:113` stops naming the doctype. The Suite invitation resource over the framework's `User Invitation` is not touched.
- [ ] The dormancy and readiness probes cover the new targets: doctype JSON still present, hooks still naming a deleted module, and the source-schema readiness probe refuse before phase 1.
- [ ] Tests: `test_gate_legacy_callers.py` proves a `permanent`-labelled name with a caller refuses, and that a `suite/public/js` hit refuses; `test_removal_phases.py` proves every class is removed and `/dav` survives; `test_full_run.py` ends with no `suite.drive.api` entry in the fake allowlist.
- [ ] Documentation synced in the same change: [implementation plan](../../drive-layer-plan.md) lines that keep `api/product.py`, `api/s3.py`, and `get_file_for_doc` ("Deleted suite code" table, and the `http/shims.py` row); `wayfinder/drive-layer-spec/implementation/legacy-caller-inventory.md`; ticket 36's permanent-path criterion.

## Verification

`python -m unittest discover -s suite/drive/patches/cleanup/tests -t .` with no site, then the no-database Build and architecture suite from ticket 35's evidence. Prove the patch is still unregistered. Record real output.

## Notes

- Stored data that carries a dotted path, checked from code: `File.file_url` on S3 sites (`S3_URL_PREFIX`, `suite/drive/utils/files.py:21`; Build step 3 gives each row a blob, Cleanup deletes the rows), Slides element `src` (Build rewrites to node ids, §14.7), `Presentation.thumbnail` (column dropped, previews replace it), invitation emails (`drive_user_invitation.py:49`, `notifications.py:77`; expire after one day). None needs a data rewrite.
- `suite/public/frontend/assets/sdk-*.js` is gitignored build output of `frontend/src/apps/drive/legacy/sdk.js`, not a checked-in bundle. The `get_file_for_doc` permanence reason was never true on this branch.
- `suite.writer.api.embed.get?id=` URLs inside Writer bodies are Writer-owned and stay. Only their Python import of `suite.drive.api.files` must move.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
