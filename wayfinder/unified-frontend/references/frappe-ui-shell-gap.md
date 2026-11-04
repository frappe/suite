# frappe-ui shell component gap

## Result

Suite does not have a shell component gap at its current pin. All 28 names in
ticket 004 are importable at commit
`a89a95fa902e18f71d01c369ad92e5cb9d3ec954`. The root names are exported by
`src/index.ts` and their family barrels. The list names are exported by
`src/molecules/list/index.ts`. The package exposes that barrel as
`frappe-ui/list`. Sources: `frappe-ui@a89a95fa:src/index.ts`,
`frappe-ui@a89a95fa:src/molecules/list/index.ts`, and
`frappe-ui@a89a95fa:package.json`.

The earliest tagged release with the whole set is `v1.0.0-beta.21`. The last
two arrivals were `BottomSheet` and `ListGroup`. Both first shipped in that
release. Sources: commits `48b40cca4f8c24a7f006e1b68911f16b7b827672`
and `c61ce8eaeb10a4f5628591f1bfa4085430aeacfa`, and tag
`v1.0.0-beta.21`.

The nearest earlier tag is `v1.0.0-beta.55`. It also has the whole set. Suite's
pin is 15 commits after that tag and still reports package version
`1.0.0-beta.55`. The exact description is
`v1.0.0-beta.55-15-ga89a95fa902e`. Sources: tag `v1.0.0-beta.55`, commit
`a89a95fa902e18f71d01c369ad92e5cb9d3ec954`,
`frappe-ui@a89a95fa:package.json`, `frontend/package.json:74`, and
`yarn.lock:4656`.

The nearest exact commit with everything is therefore Suite's current pin.
There are no changes, breaking or otherwise, between the pin and that point.
A dependency bump is not needed for the prototype shell.

The installed package report and the declared pin describe different states.
This worktree has no `frontend/node_modules` directory. The adjacent Suite
checkout has an installed package that reports `1.0.0-beta.34`. Its tarball is
commit `5b4243d13ed0f06a1e855f4a92f02ac36435f24e`. That commit also exports all
28 ticket names. Sources:
`/home/faris/benches/suite-bench/apps/suite/frontend/node_modules/frappe-ui/package.json`,
`frappe-ui@5b4243d1:src/index.ts`, and
`frappe-ui@5b4243d1:src/molecules/list/index.ts`.

## Method

"Present" means that the name can be imported from the entry point used by
the prototype. A source file by itself does not count. First versions were
found by tracing the adding commit to the first containing release tag. All
frappe-ui evidence came from the local repository at
`/home/faris/Projects/frappe-ui`. Suite import evidence came from
`frontend/src` at Suite commit
`38da831ce4150dcd4f93b30bfe21b0dd4260be54`.

## Root component inventory

| Component | Present at pin | First published version | Notes and source |
| --- | --- | --- | --- |
| `DesktopShell` | Yes | `v1.0.0-beta.20` | Added by `e9b26e46c634354595d362b743a79ac50a13ac7e`. Exported by `src/components/DesktopShell/index.ts` at `a89a95fa`. |
| `MobileShell` | Yes | `v1.0.0-beta.20` | Added with `DesktopShell` by `e9b26e46c634354595d362b743a79ac50a13ac7e`. Exported by `src/components/MobileShell/index.ts` at `a89a95fa`. |
| `Rail` | Yes | `v1.0.0-beta.20` | Added by `30bb37bbf9edee5036d048847093e2fce9cb3362`. Exported by `src/components/Rail/index.ts` at `a89a95fa`. |
| `RailItem` | Yes | `v1.0.0-beta.20` | Added with `Rail` by `30bb37bbf9edee5036d048847093e2fce9cb3362`. The `description` prop arrived in `bd86642861c88764f439c26e5061c59cb6e6bc3f`, first released in `v1.0.0-beta.31`. |
| `Sidebar` | Yes | `v0.1.166` | `AppSidebar` became `Sidebar` in `4521b2d4206ead635d302fe64d690b340daf7e41`. Commit `4d6eda7c77abfc0b6e541ab6f6e1f1e74faacdae` removed the config props and legacy slots. Compose the family in the default slot at the pin. |
| `SidebarItem` | Yes | `v0.1.217` | It became a root export in `77afef86bf89d0019179fe543b245edd7591434b`. Commit `4d6eda7c77abfc0b6e541ab6f6e1f1e74faacdae` removed `isActive` and `condition`. Use `active` and `v-if`. |
| `SidebarLabel` | Yes | `v1.0.0-beta.20` | Added by the composition-first Sidebar change `33f017e3df5f52cb0ddab5c56392a2a3957b2df8`. Exported by `src/components/Sidebar/index.ts` at `a89a95fa`. |
| `PageHeader` | Yes | `v1.0.0-beta.20` | Added by `83ab29823130d1763ab257e84a5786fc7a96d108`. Exported by `src/components/PageHeader/index.ts` at `a89a95fa`. |
| `PageHeaderMobile` | Yes | `v1.0.0-beta.20` | Added by `83ab29823130d1763ab257e84a5786fc7a96d108`. Commit `fc9a9099e869e78582aad11d5d8e9dfc10eccc15` renamed `#left` and `#right` to `#prefix` and `#suffix`. It first shipped in `v1.0.0-beta.41`. |
| `PageHeaderBackButton` | Yes | `v1.0.0-beta.20` | Added with the PageHeader family by `83ab29823130d1763ab257e84a5786fc7a96d108`. Exported by `src/components/PageHeader/index.ts` at `a89a95fa`. |
| `BottomSheet` | Yes | `v1.0.0-beta.21` | Added by `48b40cca4f8c24a7f006e1b68911f16b7b827672`. Exported by `src/components/BottomSheet/index.ts` at `a89a95fa`. |
| `MobileNav` | Yes | `v1.0.0-beta.20` | Added with the shell families by `e9b26e46c634354595d362b743a79ac50a13ac7e`. Exported by `src/components/MobileNav/index.ts` at `a89a95fa`. |
| `MobileNavItem` | Yes | `v1.0.0-beta.20` | Added with the shell families by `e9b26e46c634354595d362b743a79ac50a13ac7e`. Exported by `src/components/MobileNav/index.ts` at `a89a95fa`. |
| `ScrollArea` | Yes | `v1.0.0-beta.17` | Added by `49d2a14efe9b708de45be03d968675cc6ffb9518`. Exported by `src/components/ScrollArea/index.ts` at `a89a95fa`. |
| `ContextMenu` | Yes | `v1.0.0-beta.10` | Added by `dc9c3ed3af58f35be9eba0e337fa8a60cea2e7bb`. Commit `bc6e0308a3ad09245bc613c7cf9d4af7b33b7d01` removed component rows. Use item slots. It first shipped in `v1.0.0-beta.40`. |
| `Breadcrumbs` | Yes | `v0.1.6` | Added by `e2742821cb4b70586ed4a46ba3474a6d003bc330`. It is a root export in `src/index.ts` at tag `v0.1.6` and at `a89a95fa`. |
| `Dropdown` | Yes | `v0.0.2` | Present from `9165654b9be16e14fe9231896eadacaa7aa157d8`. Commit `bc6e0308a3ad09245bc613c7cf9d4af7b33b7d01` replaced `placement` with `align`. It also replaced group `items` with `options`. It first shipped in `v1.0.0-beta.40`. |
| `Dialog` | Yes | `v0.0.2` | Present from `9165654b9be16e14fe9231896eadacaa7aa157d8`. Commit `cc4ec176cedc914634414e6bebbf3e212c89efb0` removed the `options` blob, five legacy body slots, and `defineExpose`. It first shipped in `v1.0.0-beta.40`. |
| `TextInput` | Yes | `v0.1.0-alpha.5` | Added by `16e2803c3f42d0e3ece044dd824c4d6145d303f5`. Commit `91912e02a7b5adbd5583a738757ce2bd87e1970e` renamed exposed `el` to `inputElement` and added `focus()`. It first shipped in `v1.0.0-beta.40`. |
| `Checkbox` | Yes | `v0.1.0-alpha.5` | Added in `e61c346668e0e851b1148aba6278ee7608433259` and exported in `94bdb1c0be71ecc933fd34bc9d2140398adaf0eb`. Commit `9ea04080b47b3e68dd426f02052faa487e49bcfa` replaced `variant="padded"` with `padded`. Commit `be5912b107130d010c6b546b35af97d025b6b216` later removed `padding`. |
| `Avatar` | Yes | `v0.0.2` | Present from the first source commit `9165654b9be16e14fe9231896eadacaa7aa157d8`. It is a root export in `src/index.ts` at tag `v0.0.2` and at `a89a95fa`. |

No listed root component arrives after Suite's pin.

## `frappe-ui/list` inventory

| Component | Present at pin | First published version | Notes and source |
| --- | --- | --- | --- |
| `List` | Yes | `v1.0.0-beta.20` | Added by `511ef4286fdfe72806bd5927c71e3367725308d5`. Exported by `src/molecules/list/index.ts` at `a89a95fa`. |
| `ListHeader` | Yes | `v1.0.0-beta.20` | Added by `511ef4286fdfe72806bd5927c71e3367725308d5`. Exported by `src/molecules/list/index.ts` at `a89a95fa`. |
| `ListHeaderCellSort` | Yes | `v1.0.0-beta.20` | Added by `511ef4286fdfe72806bd5927c71e3367725308d5`. `align` and its default glyph followed before `v1.0.0-beta.21` in commits `721bcb1cf485159ba0a41add9e4be37086f584c7` and `5725905c2022d76a7f1b2dc11390203b1048eb83`. |
| `ListRows` | Yes | `v1.0.0-beta.20` | Added by `511ef4286fdfe72806bd5927c71e3367725308d5`. Exported by `src/molecules/list/index.ts` at `a89a95fa`. |
| `ListRow` | Yes | `v1.0.0-beta.20` | Added by `511ef4286fdfe72806bd5927c71e3367725308d5`. Exported by `src/molecules/list/index.ts` at `a89a95fa`. |
| `ListCell` | Yes | `v1.0.0-beta.20` | Added by `511ef4286fdfe72806bd5927c71e3367725308d5`. Exported by `src/molecules/list/index.ts` at `a89a95fa`. |
| `ListGroup` | Yes | `v1.0.0-beta.21` | Added by `c61ce8eaeb10a4f5628591f1bfa4085430aeacfa`. Exported by `src/molecules/list/index.ts` at `a89a95fa`. |

No listed list component arrives after Suite's pin.

## Entry point stability

### `frappe-ui/list`

`frappe-ui/list` is the intended stable entry point for new list code. It is a
named package export, owns its CSS side effect, and is the documented
replacement for new code. Sources:
`frappe-ui@a89a95fa:package.json`,
`frappe-ui@a89a95fa:src/molecules/list/index.ts`, and
`frappe-ui@a89a95fa:docs/content/docs/components/legacy.md:70`.

It is not formally frozen at Suite's pin because the package is still a beta.
The repository says that v1 is the freeze line. It also says that a subpath
export freezes under the compatibility rule at `1.0.0`. Sources:
`frappe-ui@a89a95fa:PHILOSOPHY.md`, sections P13 and P15.

The surface was still filling out just after its first release. Header
selection, sort alignment, the default sort glyph, and `ListGroup` landed
between beta.20 and beta.21. Sources: commits
`b9dbde0cee641d56e6f9186730609728fc74c58a`,
`721bcb1cf485159ba0a41add9e4be37086f584c7`,
`5725905c2022d76a7f1b2dc11390203b1048eb83`, and
`c61ce8eaeb10a4f5628591f1bfa4085430aeacfa`.

The remaining flux is capability, not the import location. The older
config-driven `ListView` still has resizable columns, per-column functions,
tooltips, disabled-row exclusion, and a select banner that `frappe-ui/list`
does not match. The repository still recommends `frappe-ui/list` for new code.
Sources: `frappe-ui@a89a95fa:experimental.ts:38` and
`frappe-ui@a89a95fa:v1-release/plan.md:109`.

Verdict: use `frappe-ui/list` for the new Files list. Treat the exact beta as
pinned until a v1 release or a tested later beta is chosen.

### `frappe-ui/experimental`

`frappe-ui/experimental` is explicitly unstable. Its barrel says there is no
backward-compatibility promise. P14 says it may change or disappear in any
minor or patch release. Product applications are told not to import it.
Sources: `frappe-ui@a89a95fa:experimental.ts:1`,
`frappe-ui@a89a95fa:PHILOSOPHY.md`, section P14, and
`frappe-ui@a89a95fa:docs/content/docs/experimental.md:1`.

The history matches that warning. The subpath replaced
`frappe-ui/internals` in commit
`03c02c6b5e385cbd1029340a5e334b847152d178`. ListView, old sprite icons, old
TextEditor, Calendar, old Charts, and the rebuilt CommandPalette then moved
through that barrel in commits `0e513f8ab4ff7c6cb9464e36ea0adb893c3543b3`,
`95a444349f11a3ab6ed87bf30055f49159af443a`,
`c080618e1ec97d2ae0d81ced760f996763df3c24`,
`29fb816b0e6bba449a5b9184a529d2f575938204`,
`c55f9900323b4336ae972e50a767fabad4a5b1d9`, and
`11f904edd9341a79b5b5b3a44a96dddbd0f9f4e9`.

Verdict: do not add new Suite dependencies on this subpath. Existing Suite
imports are migration debt. Pinning contains the immediate risk but does not
make the entry point stable.

## Suite's current frappe-ui surface

This inventory was built from all static imports below `frontend/src` at Suite
commit `38da831ce4150dcd4f93b30bfe21b0dd4260be54`.

- Root `frappe-ui`: `Alert`, `Avatar`, `Badge`, `BaseSuggestionItem`,
  `BottomSheet`, `Breadcrumbs`, `Button`, `Checkbox`, `Combobox`,
  `ContextMenu`, `DesktopShell`, `Dialog`, `Dialogs`, `Dropdown`,
  `DropdownOption`, `ErrorMessage`, `FileUploadHandler`, `FileUploader`,
  `FormControl`, `FormLabel`, `FrappeNetworkError`, `FrappeUIProvider`,
  `ItemListRow`, `KeyboardShortcut`, `KeyboardShortcutsDialog`,
  `LoadingIndicator`, `LoadingText`, `MobileNav`, `MobileNavItem`,
  `MobileShell`, `MultiSelect`, `Popover`, `Progress`, `Select`,
  `SettingsBody`, `SettingsContent`, `SettingsDialog`, `SettingsHeader`,
  `SettingsNavGroup`, `SettingsNavItem`, `SettingsPanel`, `SettingsRow`,
  `SettingsSidebar`, `Sidebar`, `SidebarCollapseToggle`, `SidebarHeader`,
  `SidebarItem`, `SidebarSection`, `Skeleton`, `Spinner`, `Switch`,
  `TabButtons`, `Tabs`, `TextInput`, `Tooltip`, `Tree`, `call`,
  `createDocumentResource`, `createResource`, `debounce`, `dialog`,
  `frappeRequest`, `getCachedListResource`, `getCachedResource`, `setConfig`,
  `shellScrollContainer`, `toast`, `useCall`, `useDoc`, `useFileUpload`,
  `useKeyboardShortcut`, `useList`, `useNewDoc`, `usePageMeta`, and
  `vOnOutsideClick`. Source scope: `frontend/src`.
- `frappe-ui/list`: `List`, `ListCell`, `ListGroup`, `ListHeader`,
  `ListHeaderCell`, `ListHeaderCellSort`, and `ListRow`. Sources:
  `frontend/src/apps/drive/components/ListView.vue:95`,
  `frontend/src/apps/drive/components/DriveListRow.vue:165`,
  `frontend/src/apps/drive/components/DriveListSkeleton.vue:28`, and
  `frontend/src/apps/drive/pages/Notifications.vue:70`.
- `frappe-ui/editor`: the Editor components and extensions used by Writer and
  Mail. Sources: `frontend/src/apps/writer/components/CoreEditor.vue:71`,
  `frontend/src/apps/writer/components/MarkdownEditor.vue:11`, and
  `frontend/src/apps/mail/composables/useComposeMail.ts:5`.
- `frappe-ui/experimental`: Calendar, CommandPalette, old ListView, sprite
  icons, old TextEditor, and related parts. Sources:
  `frontend/src/apps/calendar/pages/CalendarView.vue:5`,
  `frontend/src/apps/mail/components/AppSidebar.vue:119`,
  `frontend/src/apps/mail/pages/ContactsView.vue:46`,
  `frontend/src/apps/sheets/components/SheetEditor/ChartOverlay.vue:54`, and
  `frontend/src/main.ts:5`.
- One import bypasses all package entry points:
  `frappe-ui/src/components/Dialog/types`. Source:
  `frontend/src/apps/writer/utils/dialogs.ts:2`. This is private-path debt.

This section inventories import declarations. It does not mean every current
import is valid. `BaseSuggestionItem` is imported from the root in
`frontend/src/apps/mail/utils/mentionSuggestion.ts:4`, but the pin exports it
from `experimental.ts:62`. `FrappeNetworkError` is imported in
`frontend/src/apps/writer/composables/useYjs.ts:5`, but that name does not
occur in the pin's `src/index.ts` or source tree. These are baseline import
issues. They are not beta.56 regressions.

## If Suite moves to the next forward tag

The first release tag after Suite's pin is `v1.0.0-beta.56`. It is not needed
for the shell components. Three breaking changes in the interval touch names
that Suite imports. Sources: commit range
`a89a95fa902e18f71d01c369ad92e5cb9d3ec954..v1.0.0-beta.56` and
`frappe-ui@v1.0.0-beta.56:docs/content/docs/changelog.md`.

| Change | Suite exposure | Migration cost |
| --- | --- | --- |
| `Button` stops exposing `rootRef`. Commit `5c0d65ad2a6ed3061ebd220a49f0d59806808834`. | Suite imports `Button`, but `rootRef` does not occur below `frontend/src`. | No known code change. Run type checks and interaction tests. |
| `TabButtons` removes per-option `class`, `NativeButtonClass`, and slot `customClass`. It adds `data-value`. Commit `d1e1951e50950b731aaadc19d499325e3234a575`. | Suite imports `TabButtons`, but none of the removed names or fields occurs below `frontend/src`. Representative sources: `frontend/src/apps/drive/components/DriveToolBar.vue:95` and `frontend/src/apps/slides/components/FrameSection.vue:57`. | No known code change. Check tab-specific styling visually. |
| Toast removes `create`, `remove`, `removeAll`, and the legacy object form. It also sanitizes string descriptions. Commit `695aa923e98cea9b54392ba4266006b0e78bfb16`. | Suite has two `toast.create` wrapper sites and four `toast.removeAll` sites. Sources: `frontend/src/apps/drive/utils/toasts.js:7`, `frontend/src/apps/writer/utils/index.js:605`, `frontend/src/apps/calendar/utils/index.ts:22`, `frontend/src/apps/mail/utils/index.ts:95`, `frontend/src/apps/mail/utils/index.ts:120`, and `frontend/src/apps/mail/utils/composables.ts:324`. | Replace `create` with the Sonner form. Convert the wrapper duration from seconds to milliseconds. Replace `removeAll()` with `dismiss()`. The two wrapper edits cover their downstream object-shaped calls. |

The other breaking commits in this exact interval concern `ThemeSwitcher`,
DatePicker utility exports, and `HoverCard` typing. Suite does not import those
names or DatePicker helpers below `frontend/src`. Sources: commits
`6114abbaa63ddab39f58c00cd0b4fdd98bcd9e3d`,
`713aa465e3f6dd2d77f326949396a8c6e37496cd`, and
`ae6b321e9f9a8a4ef8c7a010734056360a6dd18b`, checked against
`frontend/src`.

## What Gameplan adds around `Rail`

frappe-ui's `Rail` is intentionally shallow. It renders a full-height, 50 px
wide flex column with sidebar background, fixed padding, and a shared tooltip
provider. Its slot has no built-in scrolling. `RailItem` supplies the tile or
ghost cell, route or button behavior, active state, badge, and tooltip.
Sources: `frappe-ui@a89a95fa:src/components/Rail/Rail.vue`,
`frappe-ui@a89a95fa:src/components/Rail/RailItem.vue`, and
`frappe-ui@a89a95fa:src/components/Rail/types.ts`.

Gameplan's `AppRail` adds the application structure:

- It can add the rail border. It cancels the rail's top padding and gives the
  logo a 48 px row. This aligns the logo divider with `PageHeader`.
- It puts fixed app shortcuts directly under the logo.
- It gives the community list the remaining height. That list scrolls inside
  an exact 50 px strip. Its browser scrollbar is hidden.
- It draws top and bottom fade gradients only when more content exists in that
  direction. Scroll and resize observers keep those fades correct.
- It computes route activity, descriptions, unread totals, and count or dot
  badge style from Gameplan data.
- It pins the account avatar to the bottom. An empty flex spacer preserves
  that position when there are no communities.
- It owns the sidebar customization dialog.

Source for every item above:
`gameplan@755ffd3210ec5d7afd0cf9f65b2dcb1fd4a0c17d:frontend/src/components/AppRail/AppRail.vue`.

## What Gameplan adds around `Sidebar`

frappe-ui's `Sidebar` supplies a full-height flex column, width animation,
mobile collapse behavior, and collapse state injection. It deliberately leaves
the header, scroll region, body, and footer to the app. `SidebarItem` supplies
the row, exact-route inference, slots, active styling, and collapsed tooltip.
Sources: `frappe-ui@a89a95fa:src/components/Sidebar/Sidebar.vue`,
`frappe-ui@a89a95fa:src/components/Sidebar/SidebarItem.vue`, and
`frappe-ui@a89a95fa:src/components/Sidebar/types.ts`.

Gameplan's `AppSidebar` adds the application structure:

- It disables collapse and changes the width from the library default of 15
  rem to 14 rem.
- It places a community selector in a fixed top row.
- It creates the actual scrolling body with `ScrollArea`. It adds viewport
  padding so the active-row shadow is not clipped and bottom padding for the
  end of the list.
- It adds the Spaces label, sort action, create action, and empty state.
- It calculates active space state for nested Discussion routes and a
  `NewDiscussion` query parameter. The library's built-in route inference only
  compares the target name or path exactly.
- It supplies custom space icons and a private lock marker.
- It supplies an unread count and an interactive options menu in the suffix.
  The count fades out and the menu fades in on row hover or focus.
- It filters, sorts, and mutates Gameplan space data. It owns the new-space
  dialog.

Source for every item above:
`gameplan@755ffd3210ec5d7afd0cf9f65b2dcb1fd4a0c17d:frontend/src/components/AppSidebar.vue`.

The prototype should therefore use frappe-ui's Rail and Sidebar families at
Suite's existing pin. It still needs Suite-owned wrappers for the exact
Gameplan geometry, scroll regions, route rules, badges, menus, and product
data. Those concerns are not missing library components.

## Recommendation and cost

Use `v1.0.0-beta.56` for the next forward tag. Migrate two toast wrappers and
four `removeAll` calls. Run type checks and focused shell, list, and toast UI
tests. The bump adds no shell surface because the current pin already has it.
Keep new code on `frappe-ui/list`, not `frappe-ui/experimental`. Sources:
`frontend/src/apps/drive/utils/toasts.js`,
`frontend/src/apps/writer/utils/index.js`,
`frontend/src/apps/calendar/utils/index.ts`,
`frontend/src/apps/mail/utils/index.ts`, and
`frontend/src/apps/mail/utils/composables.ts`.

## Not done

- No npm registry query was made. "Published" is inferred from local release
  tags and each tagged `package.json`.
- Later remote tags and changes were not checked.
- No package tarball was installed. No prototype build was run. Export
  presence was verified from the package manifest and source barrels.
- Ticket 004 does not name a component imported from
  `frappe-ui/experimental`. Component-level prototype use is unverified.
