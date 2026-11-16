import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import { settingsTab, showSettings } from '@/platform/settings'

import { useSettingsShortcut } from './settingsShortcut'

// The test adapter stubs frappe-ui; the key binding under test is the real one.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')),
}))

let unmount: (() => void) | undefined
// The palette's commands, as the page has registered them.
let commands: { id: string; shortcut?: string; run: () => void }[] = []

beforeEach(() => {
  commands = []
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup() {
      useSettingsShortcut(() => commands)
      return () => h('div')
    },
  })
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  showSettings.value = false
  settingsTab.value = undefined
})

afterEach(() => unmount?.())

function pressSettingsKey() {
  // Mod is Ctrl outside a Mac, and the test runner is not a Mac.
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: '<',
      code: 'Comma',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  )
}

function registerSettingsCommand(id: string, run: () => void) {
  commands.push({ id, shortcut: 'Mod+Shift+Comma', run })
}

it("opens the app's main settings tab where the app offers one", () => {
  registerSettingsCommand('shell-settings', () => {
    throw new Error('the shell command must not run where an app offers its own')
  })
  registerSettingsCommand('mail-settings', () => {
    settingsTab.value = 'mail.general'
    showSettings.value = true
  })

  pressSettingsKey()

  expect(showSettings.value).toBe(true)
  expect(settingsTab.value).toBe('mail.general')
})

it('opens the first tab where no app offers Settings, and closes Settings on a second press', () => {
  settingsTab.value = 'account.security'

  pressSettingsKey()
  expect(showSettings.value).toBe(true)
  expect(settingsTab.value).toBeUndefined()

  pressSettingsKey()
  expect(showSettings.value).toBe(false)
})
