---
id: 004
title: frappe-ui shell component gap
label: wayfinder:research
status: open
assignee:
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
