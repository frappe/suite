import { useKeyboardShortcut } from 'frappe-ui'

import { openSettings, SETTINGS_SHORTCUT, showSettings } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'

/** The id of the shell's own Settings command in the palette. */
export const SHELL_SETTINGS_COMMAND_ID = 'shell-settings'

/** A palette command, as far as the Settings key reads it. */
interface ShortcutCommand {
  readonly id: string
  readonly shortcut?: string
  run(): unknown
}

/**
 * Whether a palette command is an app's own Settings command: one that shows
 * the Settings key and is not the shell's. Where an app has one, the key runs
 * it and the palette lists it in place of the shell's.
 */
export function isAppSettingsCommand(command: Pick<ShortcutCommand, 'id' | 'shortcut'>): boolean {
  return command.shortcut === SETTINGS_SHORTCUT && command.id !== SHELL_SETTINGS_COMMAND_ID
}

/**
 * Binds the Settings key. It runs the app's Settings command that shows the
 * key in the palette, so in Mail it opens Mail's main tab. Where no app
 * command shows it, Settings opens on its first tab. Pressed while Settings
 * is open, it closes Settings.
 */
export function useSettingsShortcut(commands: () => readonly ShortcutCommand[]): void {
  useKeyboardShortcut({
    combo: SETTINGS_SHORTCUT,
    description: __('Toggle settings'),
    allowInInput: true,
    allowInDialog: true,
    handler: () => {
      if (showSettings.value) {
        showSettings.value = false
        return
      }
      const appCommand = commands().find(isAppSettingsCommand)
      if (appCommand) void appCommand.run()
      else openSettings()
    },
  })
}
