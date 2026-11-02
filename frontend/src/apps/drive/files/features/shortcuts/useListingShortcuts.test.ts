import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import {
  menuCommand,
  useListingShortcuts,
  type ListingCommands,
  type ListingView,
} from './useListingShortcuts'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')),
}))

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  document.body.innerHTML = ''
})

/** Mounts a listing whose commands are `offered`, and returns the views it opened. */
function listing(offered: ListingCommands, signedIn = true) {
  const opened: ListingView[] = []
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(
    defineComponent({
      setup() {
        useListingShortcuts(() => offered, {
          enabled: () => signedIn,
          open: (view) => opened.push(view),
        })
        return () =>
          h('div', [
            h('input', { 'aria-label': 'Search' }),
            h('div', { role: 'dialog' }, [h('button', 'Inside a dialog')]),
          ])
      },
    }),
  )
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return opened
}

function press(key: string, modifiers: KeyboardEventInit = {}, target: Element = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  target.dispatchEvent(event)
  return event
}

describe('listing shortcuts', () => {
  it('runs the command a menu offers for the key', () => {
    const move = { onClick: vi.fn() }
    const remove = { onClick: vi.fn() }
    const selectAll = { onClick: vi.fn() }
    listing({ move, remove, selectAll })

    press('m', { ctrlKey: true })
    press('Backspace', { ctrlKey: true })
    press('a', { ctrlKey: true })

    expect(move.onClick).toHaveBeenCalledOnce()
    expect(remove.onClick).toHaveBeenCalledOnce()
    expect(selectAll.onClick).toHaveBeenCalledOnce()
  })

  it('does nothing where the menu disables the command or leaves it out', () => {
    const move = { onClick: vi.fn(), disabled: true }
    listing({ move })

    const refused = press('m', { ctrlKey: true })
    const absent = press('a', { ctrlKey: true })

    expect(move.onClick).not.toHaveBeenCalled()
    // The browser keeps the key, so Ctrl+A still selects the page's text.
    expect(refused.defaultPrevented).toBe(false)
    expect(absent.defaultPrevented).toBe(false)
  })

  it('leaves keys typed in a field or pressed in a dialog alone', () => {
    const selectAll = { onClick: vi.fn() }
    const clearSelection = { onClick: vi.fn() }
    listing({ selectAll, clearSelection })

    press('a', { ctrlKey: true }, document.querySelector('input')!)
    press('Escape', {}, document.querySelector('[role="dialog"] button')!)

    expect(selectAll.onClick).not.toHaveBeenCalled()
    expect(clearSelection.onClick).not.toHaveBeenCalled()
  })

  it('opens a view with its access key once signed in', () => {
    const opened = listing({})
    press('r', { altKey: true })
    press('f', { altKey: true })
    expect(opened).toEqual(['recent', 'starred'])

    cleanup?.()
    const guest = listing({}, false)
    press('r', { altKey: true })
    expect(guest).toEqual([])
  })
})

describe('menu commands', () => {
  const run = () => {}
  const newFolder = { label: 'Folder', onClick: run }
  const uploadFolder = { label: 'Folder', onClick: run }
  const menu = [
    { group: 'Create', options: [newFolder] },
    { group: 'Upload', options: [{ label: 'Files', onClick: run }, uploadFolder] },
    { label: 'Select all', onClick: run, disabled: true },
  ]

  it('finds an option by its label, inside the named group', () => {
    expect(menuCommand(menu, 'Folder', 'Create')).toBe(newFolder)
    expect(menuCommand(menu, 'Folder', 'Upload')).toBe(uploadFolder)
    expect(menuCommand(menu, 'Select all')).toEqual({
      label: 'Select all',
      onClick: run,
      disabled: true,
    })
    expect(menuCommand(menu, 'Share')).toBeUndefined()
  })
})
