import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import {
  openAreaShortcuts,
  provideAreaShortcuts,
  shellShortcutsOpen,
  useShortcutsKey,
} from '@/platform/shortcuts'

vi.mock('frappe-ui', async () => ({
  useKeyboardShortcut: (
    await import('../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')
  ).useKeyboardShortcut,
}))

const { useKeyboardShortcut } = await import('frappe-ui')

const mounted: ReturnType<typeof createApp>[] = []

function mount(setup: () => void) {
  const app = createApp(defineComponent({ setup: () => (setup(), () => h('div')) }))
  app.mount(document.createElement('div'))
  mounted.push(app)

  return app
}

function pressQuestionMark(target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', {
    key: '?',
    code: 'Slash',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)

  return event
}

afterEach(() => {
  for (const app of mounted.splice(0)) {
    app.unmount()
  }

  shellShortcutsOpen.value = false
})

describe('openAreaShortcuts', () => {
  it('opens the area’s own list while the area is mounted, else the shell’s', () => {
    const areaOpener = vi.fn()

    openAreaShortcuts()

    expect(shellShortcutsOpen.value).toBe(true)

    shellShortcutsOpen.value = false
    const area = mount(() => provideAreaShortcuts(areaOpener))
    openAreaShortcuts()

    expect(areaOpener).toHaveBeenCalledTimes(1)
    expect(shellShortcutsOpen.value).toBe(false)

    area.unmount()
    openAreaShortcuts()

    expect(areaOpener).toHaveBeenCalledTimes(1)
    expect(shellShortcutsOpen.value).toBe(true)
  })
})

describe('the suite-wide ? key', () => {
  it('opens the shell’s list', () => {
    mount(useShortcutsKey)

    pressQuestionMark()

    expect(shellShortcutsOpen.value).toBe(true)
  })

  it('opens an area’s list once where the area binds ? itself', () => {
    const areaOpener = vi.fn()
    mount(useShortcutsKey)
    mount(() => {
      provideAreaShortcuts(areaOpener)
      useKeyboardShortcut({
        combo: 'Shift+Slash',
        description: 'View shortcuts',
        handler: areaOpener,
      })
    })

    pressQuestionMark()

    expect(areaOpener).toHaveBeenCalledTimes(1)
    expect(shellShortcutsOpen.value).toBe(false)
  })

  it('opens an area’s list once where the area listens for ? on its own', () => {
    const areaOpener = vi.fn()
    function listen(event: KeyboardEvent) {
      if (event.key === '?') {
        areaOpener()
      }
    }

    window.addEventListener('keydown', listen)
    mount(useShortcutsKey)
    mount(() => provideAreaShortcuts(areaOpener))

    pressQuestionMark()
    window.removeEventListener('keydown', listen)

    expect(areaOpener).toHaveBeenCalledTimes(1)
    expect(shellShortcutsOpen.value).toBe(false)
  })

  it('leaves a ? typed into a text field alone', () => {
    mount(useShortcutsKey)
    const field = document.createElement('input')
    document.body.append(field)

    const event = pressQuestionMark(field)
    field.remove()

    expect(shellShortcutsOpen.value).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves a ? the page already took', () => {
    mount(useShortcutsKey)
    const cell = document.createElement('canvas')
    cell.addEventListener('keydown', (event) => event.preventDefault())
    document.body.append(cell)

    pressQuestionMark(cell)
    cell.remove()

    expect(shellShortcutsOpen.value).toBe(false)
  })
})
