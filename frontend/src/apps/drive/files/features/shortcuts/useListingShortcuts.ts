import {
  useKeyboardShortcut,
  type DropdownActionOption,
  type DropdownItem,
  type KeyboardShortcutCombo,
  type KeyboardShortcutConfig,
} from 'frappe-ui'
import { getCurrentInstance } from 'vue'

import { useKeySequences, type KeySequenceShortcut, type Letter } from '@/platform/shortcuts'
import { translate as __ } from '@/platform/translation'

/** What a shortcut runs: the menu option that offers the same action, so the menu's rules apply. */
export type ListingCommand = Pick<DropdownActionOption, 'onClick' | 'disabled'>

/** The commands the listing offers at the moment of the key press. A missing one is not on offer. */
export interface ListingCommands {
  selectAll?: ListingCommand
  clearSelection?: ListingCommand
  move?: ListingCommand
  remove?: ListingCommand
  openInNewTab?: ListingCommand
  share?: ListingCommand
  upload?: ListingCommand
  newFolder?: ListingCommand
}

export type ListingView = 'personal' | 'organization' | 'shared' | 'recent' | 'starred'

export interface ListingViews {
  /** Whether the views can be opened, which takes a session. */
  enabled: () => boolean
  open: (view: ListingView) => unknown
}

/**
 * The fixed keys of the menu options that shortcuts run or menus leave out. A
 * key stays the same when the visible label is translated or reworded.
 */
export type MenuKey =
  | 'select-all'
  | 'move'
  | 'trash'
  | 'delete-forever'
  | 'restore'
  | 'open'
  | 'open-in-new-tab'
  | 'share'
  | 'select'
  | 'remove-from-recent'
  | 'create-folder'
  | 'upload-files'
  | 'upload-folder'

/** The action option with `key`, in any group. A key is unique within a menu. */
export function menuCommand(
  items: readonly DropdownItem[],
  key: MenuKey,
): ListingCommand | undefined {
  const options = items.flatMap((item) => ('group' in item ? item.options : [item]))
  return options.find(
    (option): option is DropdownActionOption => 'label' in option && option.key === key,
  )
}

type Choose = (offered: ListingCommands) => ListingCommand | undefined

/**
 * Registers the listing's keyboard shortcuts while the calling component is
 * mounted. The shell's `?` dialog lists them. Share, Upload and New folder are
 * plain letters and a view is `G` then a letter, Gmail style, so no key clashes
 * with the browser's or the system's own; none of them fire in a text field.
 * Call it in a component's setup.
 */
export function useListingShortcuts(commands: () => ListingCommands, views: ListingViews): void {
  const instance = getCurrentInstance()
  /** Menus report a rejected action through the app, so a shortcut does too. */
  async function run(command: ListingCommand, event: KeyboardEvent) {
    try {
      await command.onClick?.(event)
    } catch (error) {
      const report = instance?.appContext.config.errorHandler
      if (report) report(error, instance?.proxy ?? null, 'keyboard shortcut')
      else console.error(error)
    }
  }
  const handle = (pick: Choose) => (event: KeyboardEvent) => {
    const chosen = pick(commands())
    if (!chosen || chosen.disabled) return
    event.preventDefault()
    void run(chosen, event)
  }
  const command = (
    combo: KeyboardShortcutCombo,
    description: string,
    pick: Choose,
  ): KeyboardShortcutConfig => ({
    combo,
    description,
    group: __('Files'),
    // A key the listing does not use now keeps its usual meaning, such as Escape closing a menu.
    preventDefault: false,
    handler: handle(pick),
  })
  const letter = (key: Letter, description: string, pick: Choose): KeySequenceShortcut => ({
    keys: [key],
    description,
    group: __('Files'),
    handler: handle(pick),
  })
  const view = (key: Letter, description: string, target: ListingView): KeySequenceShortcut => ({
    keys: ['G', key],
    description,
    group: __('Go to'),
    enabled: views.enabled,
    handler: () => void views.open(target),
  })
  useKeyboardShortcut([
    command('Mod+A', __('Select all'), (offered) => offered.selectAll),
    command('Escape', __('Clear selection'), (offered) => offered.clearSelection),
    command('Ctrl+M', __('Move selected items'), (offered) => offered.move),
    command('Mod+Backspace', __('Delete selected items'), (offered) => offered.remove),
    command('Mod+Enter', __('Open selected item in a new tab'), (offered) => offered.openInNewTab),
  ])
  useKeySequences([
    letter('S', __('Share selected item'), (offered) => offered.share),
    letter('U', __('Upload files'), (offered) => offered.upload),
    letter('N', __('New folder'), (offered) => offered.newFolder),
    view('H', __('My files'), 'personal'),
    view('E', __('Organization files'), 'organization'),
    view('I', __('Shared with me'), 'shared'),
    view('R', __('Recent'), 'recent'),
    view('F', __('Starred'), 'starred'),
  ])
}
