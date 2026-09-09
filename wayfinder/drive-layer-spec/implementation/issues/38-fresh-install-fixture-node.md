# 38 — Make a fresh suite install succeed with the Presentation template fixtures

**What to build:** `bench new-site --install-app suite` on `forge/drive-layer` fails during `sync_fixtures`. `suite/fixtures/presentation.json` ships two `is_template: 1` Presentation rows with no Drive node. `require_node` in `suite/drive/_core/content.py:757-772` raises `DriveConflict`, because `Presentation` is governed unconditionally through `drive_content_types` (`suite/hooks.py:185-189`). The failure leaves `property_setter.json` and `role.json` unsynced and skips `after_sync`. `bench migrate` on an existing site hits the same path: `import_doc` runs with `force=True` and deletes and re-inserts the rows, so Build's `convert_templates` does not help. Only `--skip-fixtures` avoids it.

**Blocked by:** None

**Status:** ready-for-agent

**Owner:** Suite Drive content

**Execution gate:** None.

**Source:** [Drive spec](../../drive-layer-spec.md), §8.10 templates and `Drive Node.is_template`; decision [012 — Slides media to nodes](../../tickets/012-slides-media-to-nodes.md); [18 — Move Slides documents and media into Drive](18-slides-adoption.md); [16 — Create content documents and media through one Drive contract](16-content-contract.md).
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] A fresh `bench new-site --install-app suite` completes with no traceback, and all four fixture files sync.
- [ ] `bench migrate --skip-fixtures` is no longer needed on a restored production copy.
- [ ] Template Presentations created by fixtures own a Drive node and a template grant, per the spec.
- [ ] A test covers fixture import of a template.
- [ ] Existing template rows on a migrated site keep their node.

## Verification

Run a fresh site install on a scratch site name, then run `bench migrate` on that site. Run the drive test module for content.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
