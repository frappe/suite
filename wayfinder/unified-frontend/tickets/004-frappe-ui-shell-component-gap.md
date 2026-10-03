---
id: 004
title: frappe-ui shell component gap
label: wayfinder:research
status: closed
assignee: codex (agent, 2026-09-11)
blocked-by: []
---

## Question

Suite pins frappe-ui at commit `a89a95fa902e18f71d01c369ad92e5cb9d3ec954`.
The base prototype pins `1.0.0-beta.55` and uses DesktopShell, MobileShell,
Rail, RailItem, Sidebar, SidebarItem, SidebarLabel, PageHeader,
PageHeaderMobile, PageHeaderBackButton, BottomSheet, MobileNav,
MobileNavItem, ScrollArea, ContextMenu, Breadcrumbs, Dropdown, Dialog,
TextInput, Checkbox, Avatar, and `frappe-ui/list` (List, ListHeader,
ListHeaderCellSort, ListRows, ListRow, ListCell, ListGroup).

Find, from the frappe-ui repository and its published versions:

- Which of these exist at suite's pinned commit, which arrive later, and in
  which release each landed.
- The nearest tag or commit that has all of them, and every breaking change
  between suite's pin and that point that touches components suite uses
  today (grep `frontend/src` for `from 'frappe-ui'` imports to build the
  list).
- Whether `frappe-ui/list` and `frappe-ui/experimental` subpaths are stable
  entry points or in flux.
- What Gameplan's AppRail and AppSidebar do that frappe-ui's Rail and Sidebar
  do not, since the prototype copies Gameplan's geometry.

Output: `wayfinder/unified-frontend/references/frappe-ui-shell-gap.md` with
a table per component (present at pin, first version, notes) and a bump
recommendation with its cost.

## Resolution

Resolved 2026-09-11 by a codex agent. Findings:
[`../references/frappe-ui-shell-gap.md`](../references/frappe-ui-shell-gap.md)
(branch `forge/research-frappe-ui-shell-gap`, commit `e93f15112`). The
orchestrator verified the family-barrel exports at the pin in
`node_modules/frappe-ui/src` and the lock entry.

- No gap. All 28 names the prototype imports are exported at suite's pin
  (`a89a95fa`, 15 commits after `v1.0.0-beta.55`). The map's earlier note
  that RailItem, SidebarItem, SidebarLabel and PageHeaderMobile were missing
  was a grep error: they come through `export *` family barrels.
- Earliest tag with the whole set: `v1.0.0-beta.21`. No bump is needed for
  the shell.
- If a forward tag is wanted, `v1.0.0-beta.56` costs one toast migration
  (two wrapper sites, four `removeAll` sites) and re-tests of Button and
  TabButtons. Nothing else suite imports breaks in that interval.
- `frappe-ui/list` is the stable entry for new lists; use it for Files.
  `frappe-ui/experimental` carries no compatibility promise; add no new
  imports (Calendar, Mail, Sheets and `main.ts` already depend on it).
- One private-path import is debt: `frappe-ui/src/components/Dialog/types`
  in `frontend/src/apps/writer/utils/dialogs.ts`.
- frappe-ui's Rail and Sidebar are shallow by design. Suite needs its own
  wrappers for Gameplan's geometry, scroll fades, route rules and badges.
- Local fact: `frontend/node_modules/frappe-ui` was installed on 23 Aug and
  reports beta.34; the lock resolves the pin to beta.55. Run `yarn install`
  before building on the shell.

Handed to [Shell and platform interface](002-shell-and-platform-interface.md)
and [Frontend module layout and import boundaries](013-frontend-module-layout-and-boundaries.md).
