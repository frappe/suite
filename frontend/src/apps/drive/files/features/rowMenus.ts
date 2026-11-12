import type { DropdownGroupOption, DropdownItem, DropdownOption } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

import type { MenuKey } from './shortcuts/useListingShortcuts'

/**
 * Menus built from a row's own menu, so the open folder and a one-item
 * selection offer the same actions as the item's row (unified frontend spec
 * §5.6, §5.8). Options are matched by their fixed `key`.
 */

/** What only a row in the listing needs: the folder is already open, and a selection is already made. */
const NOT_FOR_OPEN_FOLDER: readonly MenuKey[] = [
  'open',
  'open-in-new-tab',
  'select',
  'remove-from-recent',
  // A trashed folder's notice offers these, and leaves the page when it deletes.
  'restore',
  'delete-forever',
]
const NOT_FOR_SELECTION: readonly MenuKey[] = ['select', 'remove-from-recent']

/**
 * The open folder's menu: its row menu under the heading "This folder".
 * Moving it to Trash runs `trash`, so the page can leave the folder.
 */
export function folderMenu(rowMenu: readonly DropdownItem[], trash: () => unknown): DropdownItem[] {
  const groups = withoutKeys(rowMenu, NOT_FOR_OPEN_FOLDER).map((item): DropdownItem => {
    if (!isGroup(item)) return item
    const options = item.options.map((option): DropdownOption =>
      option.key === 'trash' && !option.submenu && !option.switch
        ? { ...option, onClick: trash }
        : option,
    )
    return { ...item, options }
  })
  const [first, ...rest] = groups
  if (!first || !isGroup(first)) return groups
  return [{ ...first, group: __('This folder'), hideLabel: false }, ...rest]
}

/** The "…" menu of a one-item selection: the item's row menu without Select. */
export function selectionMenu(rowMenu: readonly DropdownItem[]): DropdownItem[] {
  return withoutKeys(rowMenu, NOT_FOR_SELECTION)
}

/** The menu without the options keyed `keys`, and without the groups that leaves empty. */
function withoutKeys(items: readonly DropdownItem[], keys: readonly MenuKey[]): DropdownItem[] {
  const kept = (option: DropdownOption) => !keys.includes(option.key)
  return items.flatMap((item): DropdownItem[] => {
    if (!isGroup(item)) return kept(item) ? [item] : []
    const options = item.options.filter(kept)
    return options.length ? [{ ...item, options }] : []
  })
}

/** Options carry an index signature, so `'group' in item` alone does not narrow. */
function isGroup(item: DropdownItem): item is DropdownGroupOption {
  return 'group' in item && Array.isArray(item.options)
}
