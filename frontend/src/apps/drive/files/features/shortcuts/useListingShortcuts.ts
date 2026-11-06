import {
  useKeyboardShortcut,
  type DropdownActionOption,
  type DropdownItem,
  type KeyboardShortcutCombo,
  type KeyboardShortcutConfig,
} from 'frappe-ui'
import { getCurrentInstance } from 'vue'

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

type Letter = 'E' | 'F' | 'H' | 'I' | 'N' | 'R' | 'S' | 'U'

/**
 * The action option labelled `label`, inside the group named `group` when
 * given. Menu labels are unique within a group.
 */
export function menuCommand(
  items: readonly DropdownItem[],
  label: string,
  group?: string,
): ListingCommand | undefined {
  const options = items.flatMap((item) => {
    if ('group' in item) return group === undefined || item.group === group ? item.options : []
    return group === undefined ? [item] : []
  })
  return options.find(
    (option): option is DropdownActionOption => 'label' in option && option.label === label,
  )
}

/**
 * Registers the listing's keyboard shortcuts while the calling component is
 * mounted. The shell's `?` dialog lists them. Call it in a component's setup.
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
  const command = (
    combo: KeyboardShortcutCombo,
    description: string,
    pick: (offered: ListingCommands) => ListingCommand | undefined,
  ): KeyboardShortcutConfig => ({
    combo,
    description,
    group: __('Files'),
    // A key the listing does not use now keeps its usual meaning, such as Escape closing a menu.
    preventDefault: false,
    handler: (event) => {
      const chosen = pick(commands())
      if (!chosen || chosen.disabled) return
      event.preventDefault()
      void run(chosen, event)
    },
  })
  const view = (letter: Letter, description: string, target: ListingView) => ({
    combo: accessKey(letter),
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
    command(accessKey('S'), __('Share selected item'), (offered) => offered.share),
    command(accessKey('U'), __('Upload files'), (offered) => offered.upload),
    command(accessKey('N'), __('New folder'), (offered) => offered.newFolder),
    view('H', __('My files'), 'personal'),
    view('E', __('Organization files'), 'organization'),
    view('I', __('Shared with me'), 'shared'),
    view('R', __('Recent'), 'recent'),
    view('F', __('Starred'), 'starred'),
  ])
}

/**
 * A letter with the modifier that leaves the browser's own shortcuts alone:
 * Control on a Mac, Alt and Shift in Firefox, where Alt opens its menus, and
 * Alt elsewhere.
 */
function accessKey(letter: Letter): KeyboardShortcutCombo {
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) return `Ctrl+${letter}`
  if (navigator.userAgent.includes('Firefox')) return `Alt+Shift+${letter}`
  return `Alt+${letter}`
}
