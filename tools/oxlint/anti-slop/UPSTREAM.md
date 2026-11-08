# Anti-slop provenance

Vendored from https://github.com/dmmulroy/anti-slop at
`13909c9e07590f5a85d93c62712259fe14a883f7` (MIT).

The generic plugin source is copied unchanged. Upstream test files and the
Effect plugin are omitted; Suite does not depend on Effect. Keep LICENSE and
vendor/eslint-stylistic/{LICENSE,UPSTREAM.md} with the source on updates.

Suite owns rule selection in the root `.oxlintrc.json`. Run
`pnpm lint:anti-slop` to see advisory findings (the normal lint command hides
warnings). Advisory rules do not create or extend a debt baseline.

Policy exceptions:

- Unknown inputs, returns, aliases and dictionary values are permitted: Suite
  validates untrusted values at module boundaries.
- Runtime typeof checks are permitted for boundary validation.
- Module mocking is permitted at external boundaries, per STANDARDS.md.
- Symbol naming follows domain vocabulary, without a blanket ban on "shape".
- Readable spacing is left to Prettier and code review.

`no-reduce-accumulator-copy` and `no-widen-then-assert` are errors. Other
selected rules are advisory while existing code is migrated; promote them to
errors when clean, without introducing a baseline.

Update by reviewing the upstream diff, copying generic source while preserving
local changes, matching exact oxlint and @oxlint/plugins versions, then running
`pnpm lint:anti-slop` and `pnpm lint`. Do not overwrite Suite's policy choices
with the upstream preset.

The repository-wide scan also exposes two pre-existing native-rule findings
outside the former frontend scope. File-specific warning overrides preserve
that prior enforcement level: `promise/no-multiple-resolved` in recorder's
RecorderSharedStage integration fixture (mutually exclusive ternary callbacks),
and `no-unsafe-finally` in the E2E load runner (JWT refusal during final report
writing). Neither override disables anti-slop; remove each override when its
owner rewrites that control flow.
