"""Versioning module — event log + Drive versions.

The architecture, in three lines:

* `Sheet Op Log` is the canonical, append-only history (event sourcing).
* A sheet's versions are `Drive Node Version` rows (§9.1): `save` takes one
  through `drive.take_version`, and Drive lists, labels, restores and prunes them.
* The live `Sheet.sheets_data` blob is the materialised head, kept hot
  for fast reads and updated in-place on every save.

Public surface:

* `seq.allocate(sheet)`   — atomically allocate the next op-log seq
* `save.save_sheet(...)`  — the one write path for a body
* `ops.for_cell(...)`     — one cell's history out of the op log
* `api.ops_for_cell`     — the one whitelisted endpoint
* `tasks.*`               — scheduled op-log truncation
"""
