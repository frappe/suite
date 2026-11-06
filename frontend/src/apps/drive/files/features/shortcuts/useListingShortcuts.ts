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
import { useTweak } from '@/platform/tweaks'

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
  rename?: ListingCommand
  /** Opens the folder above the open one. */
  parent?: ListingCommand
  /** Runs the newest Undo still on screen. Answers whether one ran. */
  undo?: () => boolean
}

/** Where the listing is, for the keys that mean something else there. */
export interface ListingPlace {
  /** In Trash, the delete keys delete forever. */
  inTrash: () => boolean
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
  | 'rename'
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
export function useListingShortcuts(
  commands: () => ListingCommands,
  views: ListingViews,
  place: ListingPlace = { inTrash: () => false },
): void {
  const instance = getCurrentInstance()
  const deleteKey = useTweak('t14-delete-key')
  const renameKey = useTweak('t14-rename-key')
  const parentKey = useTweak('t14-parent-key')
  const undoKey = useTweak('t14-undo-key')
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
    { enabled, guarded = false }: { enabled?: () => boolean; guarded?: boolean } = {},
  ): KeyboardShortcutConfig => ({
    combo,
    description,
    group: __('Files'),
    ...(enabled ? { enabled } : {}),
    // A key the listing does not use now keeps its usual meaning, such as Escape closing a menu.
    preventDefault: false,
    handler: (event) => {
      if (guarded && isStray(event)) return
      handle(pick)(event)
    },
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
  // Delete and Mod+Backspace say what they do here: in Trash they delete forever.
  const removeKeys = (description: string, enabled: () => boolean) =>
    (['Mod+Backspace', 'Delete'] as const).map((combo) =>
      command(combo, description, (offered) => offered.remove, { enabled, guarded: true }),
    )
  useKeyboardShortcut([
    command('Mod+A', __('Select all'), (offered) => offered.selectAll),
    command('Escape', __('Clear selection'), (offered) => offered.clearSelection),
    command('Ctrl+M', __('Move selected items'), (offered) => offered.move),
    command('Mod+Backspace', __('Delete selected items'), (offered) => offered.remove, {
      enabled: () => !deleteKey.value,
    }),
    ...removeKeys(__('Move selected items to Trash'), () => deleteKey.value && !place.inTrash()),
    ...removeKeys(__('Delete selected items forever'), () => deleteKey.value && place.inTrash()),
    command('F2', __('Rename'), (offered) => offered.rename, {
      enabled: () => renameKey.value,
      guarded: true,
    }),
    command(
      isApple() ? 'Mod+ArrowUp' : 'Alt+ArrowUp',
      __('Open parent folder'),
      (offered) => offered.parent,
      { enabled: () => parentKey.value, guarded: true },
    ),
    {
      combo: 'Mod+Z',
      description: __('Undo'),
      group: __('Files'),
      enabled: () => undoKey.value,
      // With nothing to undo, the browser keeps the key, such as Safari reopening a closed tab.
      preventDefault: false,
      handler: (event) => {
        if (!isStray(event) && commands().undo?.()) event.preventDefault()
      },
    },
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

function isApple(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

/**
 * A key the listing leaves alone: a held key repeating, which would trash one
 * row after another, or a key pressed in an open menu, which belongs to the menu.
 */
function isStray(event: KeyboardEvent): boolean {
  const target = event.target
  return (
    event.repeat ||
    (target instanceof Element && !!target.closest('[role="menu"], [role="listbox"]'))
  )
}
