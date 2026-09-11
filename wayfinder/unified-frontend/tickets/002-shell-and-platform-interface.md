---
id: 002
title: Shell and platform interface
label: wayfinder:grilling
status: open
assignee:
blocked-by: [001]
---

## Question

Define the two interfaces every area depends on.

The shell's interface to an area: how an area declares itself (registry
entry: id, label, icon, rail position, route module, panel body, scroll
ownership), what the shell renders around it (rail, contextual panel slot,
page header slot, mobile nav and sheet), and what an open document gets
(panel hidden, title bar owned by the shell, back on mobile).

The platform's interface to everything: session and user, the REST client
for `/api/suite/...` (envelope, errors, cursor helper, link-code header),
realtime socket, theme, translation, page meta, toasts and dialogs, feature
flags such as `jmapUser` and `systemUser`. Decide which of these exist today
under `boot/`, `composables/`, `stores/` and `utils/` and move as-is, which
are rewritten, and which stay app-private. Name the import path
(`@/platform/...`) and the rule for entering it (product-neutral, two
consumers).

Inputs: `frontend/src/boot/*`, `frontend/src/shell/*`,
`frontend/src/apps/registry.ts`, the prototype's `ShellLayout.vue` and
`ContextualPanelBody.vue`, ARCHITECTURE.md rule 8, Drive spec §11.1, §11.4,
§11.6, §4.7.
