# 01 — Freeze the Drive interface and enforce product boundaries

**What to build:** Give product callers one supported Drive interface. Detect new boundary violations before the rewrite expands.

**Blocked by:** None — can start immediately after execution is authorized.

**Status:** done

**Owner:** Codex (`/root`), Suite architecture

**Starting revisions:** Suite `25d94018ad5e6cbeb63e5cd5399ca4b2d5f2a7d7`;
Frappe `89c2aec20e15815def20b74931f5c72d6adb1de0`.

**Claimed files:** `suite/tests/test_architecture.py`,
`suite/drive/__init__.py`, `frontend/scripts/check-import-boundaries.mjs`,
`frontend/package.json`, `frontend/src/apps/drive/index.ts`, and this ticket.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §2; architecture charter; architecture gate.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Inventory production callers in Writer, Slides, Sheets, Meet, Suite lifecycle wiring, and existing compatibility endpoints.
- [x] Freeze the minimal package-root exports from real callers. Keep unfinished workflows unavailable rather than returning placeholder success.
- [x] Enforce Python imports, dynamic imports, and Frappe hook boundaries. Baseline existing debt with explicit removal owners.
- [x] Enforce frontend product import boundaries without reorganizing unrelated products.
- [x] Keep Drive policy private and principals explicit. Record the content contract and composition ownership.
- [x] Record baseline test failures and the exact Suite/framework revisions before implementation. Preserve existing work.

## Verification

Run architecture checks and export contract checks. Demonstrate that an added forbidden import fails the boundary check.

## Completion evidence

### Caller inventory

No production Python caller used the supported `from suite import drive` seam
at the starting revision. The legacy callers below therefore remain explicit
debt until the complete replacement workflows exist:

| Caller | Legacy Drive capabilities used |
|---|---|
| Writer | File lookup/upload/title, access checks and shapes, file creation/storage, notifications, and the legacy content `File` controller |
| Slides | Access and query hooks, file creation/root lookup, and the legacy content `File` controller |
| Sheets | Access checks, migration helpers, and the legacy content `File` controller |
| Meet | Storage reservations and usage, owner storage locks, file creation/naming/accounting, and storage-driver details |
| Suite lifecycle | Drive install/custom-field calls from `suite_core.boot`; permission, DocType, request, upload, scheduler, and WebDAV dotted targets in `suite.hooks` |

The frontend production callers use `ShareDialog`, `MoveDialog`, `InfoDialog`,
`allUsers`, `copyToClipboard`, `getFileForDoc`, `getFileLink`, `prettyData`,
`rename`, and `rootInfo` from the existing Drive SDK. Those names are now the
explicit `frontend/src/apps/drive/index.ts` interface. Direct Writer imports of
Drive selection state, a component, and file resources remain owned frontend
adoption debt.

Existing whitelisted compatibility endpoints were inventoried by module:

- `activity`: `get_entity_activity_log`; `embed`: `get_file_content`.
- `files`: `upload_file`, `get_thumbnail`, `create_folder`, `create_link`,
  `create_auth_token`, `get_file_content`, `stream_file_content`,
  `download_folder`, `download_status`, `download_archive`, `set_favourite`,
  `remove_or_restore`, `delete_entities`, `rename`, `update_access`,
  `remove_recents`, `does_entity_exist`, `get_new_title`, `move`, `search`,
  `translate_old_name`, `get_entity_type`, `get_root_folder`,
  `redirect_to_original`, `track_visit`, `resolve_legacy_route`.
- `list`: `files`, `shared`, `favourites`, `recents`, `trash`,
  `get_attachments`; `notifications`: `get_notifications`, `get_unread_count`,
  `mark_as_read`; `permissions`: `get_user_access`, `get_general_access`,
  `get_entity_with_permissions`, `get_shared_with_list`.
- `product`: `get_my_invites`, `get_pending_invites`, `signup`,
  `oauth_providers`, `send_otp`, `verify_otp`, `get_settings`, `set_settings`,
  `invite_users`, `get_users`, `get_user_groups`, `accept_invite`,
  `reject_invite`, `get_translations`, `is_site_admin`, `disk_settings`,
  `webdav_config`, `set_webdav_enabled`, `signup_disabled`.
- `s3`: `fetch`; `scripts`: `sync_preview`, `sync_from_disk`; `storage`:
  `storage_breakdown`, `storage_bar_data`.

### Interface and ownership decisions

- `suite.drive.__all__` is deliberately empty at this gate. No replacement
  workflow is complete and no production caller uses the package root yet;
  exporting legacy steps would expose a shallow or misleading interface.
  Each later implementation ticket adds only its completed, caller-backed
  workflows and updates the exact contract test.
- Drive policy stays behind the Drive module. The gate permits outside Python
  callers only at `suite.drive`; future HTTP, WebDAV, and framework adapters
  can use the private implementation from inside Drive. The future principal
  value remains an explicit argument to that implementation and is not a
  public product type.
- The Content Type interface is owned by Drive, while Writer, Sheets, and
  Slides own their adapters. Suite composition owns registration. Its runtime
  types remain unavailable until ticket 16 implements the complete contract.

### Verification evidence

Starting and completion revisions (working tree changes uncommitted when this
evidence was written): Suite `25d94018ad5e6cbeb63e5cd5399ca4b2d5f2a7d7`;
Frappe `89c2aec20e15815def20b74931f5c72d6adb1de0`.

- Baseline before implementation:
  `bench --site slides.localhost run-tests --app suite` — exit 0; 22 unit tests
  and 444 executed integration tests passed, with no failures.
- `bench --site slides.localhost run-tests --module suite.tests.test_architecture`
  — exit 0; five checks passed. The synthetic static/private and dotted-string
  imports prove a newly added forbidden dependency fails classification.
- `yarn check:import-boundaries` from `frontend/` — exit 0; its fail/allow
  self-test passed and 29 exact, owned legacy frontend violations matched the
  baseline.
- Post-change `bench --site slides.localhost run-tests --app suite` — exit 0;
  22 unit tests and 449 executed integration tests passed.
- `git diff --check` — exit 0.

The architecture check baselines 121 exact Python occurrences. Each debt group
records a removal owner and condition; occurrence counts ensure another import
of an already-used private module still fails.

Non-gating broader check: `yarn test` ran 2,276 frontend tests; 2,218 passed,
57 failed, one skipped, and one suite failed to load. The loader could not
resolve the already-declared `mammoth` package, while the other failures report
duplicate Tiptap/ProseMirror plugin instances or their downstream null editor.
No failing file is changed by this ticket. Dependency installation and
unrelated frontend repair are outside this run's authority.

No migration, persistent state, or deployment behavior changed, so no rollback
workflow is required. Remaining gates are the implementation tickets that
replace each baselined dependency and populate the Python interface.
