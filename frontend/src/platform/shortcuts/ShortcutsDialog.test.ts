import type { KeyboardShortcutCombo } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { ShortcutsDialog, useKeySequences } from '@/platform/shortcuts'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/components/KeyboardShortcutsDialog')),
  ...(await import('../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/TextInput')),
}))

const { useKeyboardShortcut } = await import('frappe-ui')

let cleanup: (() => void) | undefined
const dialogOpen = ref(true)
afterEach(() => {
  cleanup?.()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** Opens the dialog over a page that registered Suite's, Drive's and frappe-ui's kinds of shortcut. */
async function openDialog(platform: string, filler = 0) {
  dialogOpen.value = true
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0')
  const handler = () => {}
  const app = createApp(
    defineComponent({
      setup() {
        useKeyboardShortcut([
          { combo: 'Shift+Slash', description: 'View shortcuts', group: 'Suite', handler },
          { combo: 'Mod+K', description: 'Search Suite', group: 'Suite', handler },
          { combo: 'Mod+Backspace', description: 'Delete selected items', group: 'Files', handler },
          { combo: 'Escape', description: 'Clear selection', group: 'Files', handler },
          { combo: 'Mod+End', description: 'Last item', group: 'Files', handler },
          // frappe-ui's Settings dialog registers its toggle with no group.
          { combo: 'Mod+Shift+Comma', description: 'Toggle settings', handler },
          ...Array.from({ length: filler }, (_, index) => ({
            combo: `F${index + 1}` as KeyboardShortcutCombo,
            description: `Filler ${index + 1}`,
            group: 'Sheet',
            handler,
          })),
        ])
        useKeySequences([
          { keys: ['S'], description: 'Share selected item', group: 'Files', handler },
          { keys: ['G', 'H'], description: 'My files', group: 'Go to', handler },
        ])
        return () =>
          h(ShortcutsDialog, {
            open: dialogOpen.value,
            'onUpdate:open': (open: boolean) => (dialogOpen.value = open),
          })
      },
    }),
  )
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  cleanup = () => app.unmount()
  await nextTick()
  await nextTick()
}

/** Each group's rows as the reader sees them: description, then the keycaps in order. */
function listing(): Record<string, Record<string, string[]>> {
  const groups = [...document.querySelectorAll('section')].map((section) => {
    const rows = [...section.querySelectorAll('h3 ~ div')].map((row) => [
      row.firstElementChild?.textContent?.trim() ?? '',
      [...row.querySelectorAll('[role="img"] *')]
        .filter((part) => !part.children.length)
        .map((part) => part.textContent?.trim() ?? ''),
    ])
    return [section.querySelector('h3')?.textContent?.trim() ?? '', Object.fromEntries(rows)]
  })
  return Object.fromEntries(groups)
}

describe('the shortcuts dialog', () => {
  it('lists Suite first with the untitled shortcuts, and draws Mac keys as glyphs', async () => {
    await openDialog('MacIntel')

    expect(Object.keys(listing())).toEqual(['Suite', 'Files', 'Go to'])
    expect(listing()).toEqual({
      Suite: {
        'View shortcuts': ['?'],
        'Search Suite': ['⌘', 'K'],
        'Toggle settings': ['⇧', '⌘', ','],
      },
      Files: {
        'Delete selected items': ['⌘', '⌫'],
        'Clear selection': ['⎋'],
        'Last item': ['⌘', '↘'],
        'Share selected item': ['S'],
      },
      'Go to': { 'My files': ['G', 'then', 'H'] },
    })
  })

  it('draws keys as words off a Mac', async () => {
    await openDialog('Linux x86_64')

    expect(listing()).toMatchObject({
      Suite: {
        'View shortcuts': ['?'],
        'Search Suite': ['Ctrl', 'K'],
        'Toggle settings': ['Ctrl', 'Shift', ','],
      },
      Files: {
        'Delete selected items': ['Ctrl', 'Backspace'],
        'Clear selection': ['Esc'],
        'Last item': ['Ctrl', 'End'],
      },
    })
  })

  it('names a sequence for a screen reader', async () => {
    await openDialog('MacIntel')

    expect(document.querySelector('[aria-label="G then H"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Shift Command ,"]')).not.toBeNull()
  })

  it('offers no search on a short list', async () => {
    await openDialog('MacIntel')

    expect(document.querySelector('input[aria-label="Search shortcuts"]')).toBeNull()
  })

  it('searches every row once the list is long, letter keys included', async () => {
    await openDialog('Linux x86_64', 20)
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search shortcuts"]')
    expect(search).not.toBeNull()
    async function type(text: string) {
      search!.value = text
      search!.dispatchEvent(new Event('input'))
      await nextTick()
    }

    await type('share')
    expect(listing()).toEqual({ Files: { 'Share selected item': ['S'] } })

    await type('g then h')
    expect(listing()).toEqual({ 'Go to': { 'My files': ['G', 'then', 'H'] } })

    await type('nothing like this')
    expect(listing()).toEqual({})
    expect(document.body.textContent).toContain('No shortcuts match your search.')

    dialogOpen.value = false
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    dialogOpen.value = true
    await vi.waitFor(() =>
      expect(Object.keys(listing())).toEqual(['Suite', 'Files', 'Sheet', 'Go to']),
    )
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Search shortcuts"]')?.value,
    ).toBe('')
  })
})
