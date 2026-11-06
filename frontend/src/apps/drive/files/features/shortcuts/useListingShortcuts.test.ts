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
  vi.useRealTimers()
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

  it('opens a view with G then a letter once signed in', () => {
    const opened = listing({})
    press('g')
    press('r')
    press('g')
    press('f')
    expect(opened).toEqual(['recent', 'starred'])

    cleanup?.()
    const guest = listing({}, false)
    press('g')
    press('r')
    expect(guest).toEqual([])
  })

  it('shares, uploads and makes a folder from a plain letter', () => {
    const share = { onClick: vi.fn() }
    const upload = { onClick: vi.fn() }
    const newFolder = { onClick: vi.fn() }
    listing({ share, upload, newFolder })

    press('s')
    press('u')
    press('n')

    expect(share.onClick).toHaveBeenCalledOnce()
    expect(upload.onClick).toHaveBeenCalledOnce()
    expect(newFolder.onClick).toHaveBeenCalledOnce()
  })

  it('leaves letters typed in a field, an editor or a dialog, or with a modifier, alone', () => {
    const share = { onClick: vi.fn() }
    const opened = listing({ share })
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    document.body.append(editor)

    press('s', {}, document.querySelector('input')!)
    press('s', {}, editor)
    press('s', {}, document.querySelector('[role="dialog"] button')!)
    press('s', { ctrlKey: true })
    press('s', { metaKey: true })
    press('S', { shiftKey: true })
    press('g', {}, document.querySelector('input')!)
    press('h', {}, document.querySelector('input')!)
    press('g', { altKey: true })
    press('h')

    expect(share.onClick).not.toHaveBeenCalled()
    expect(opened).toEqual([])
  })

  it('forgets a pending G after any other key or a pause', () => {
    vi.useFakeTimers()
    const share = { onClick: vi.fn() }
    const opened = listing({ share })

    press('g')
    press('s')
    press('h')
    press('g')
    press('Escape')
    press('r')
    press('g')
    vi.advanceTimersByTime(1600)
    press('f')

    expect(opened).toEqual([])
    expect(share.onClick).not.toHaveBeenCalled()
  })
})

describe('menu commands', () => {
  const run = () => {}
  const newFolder = { key: 'create-folder', label: 'Folder', onClick: run }
  const uploadFolder = { key: 'upload-folder', label: 'Folder', onClick: run }
  const selectAll = { key: 'select-all', label: 'Tout sélectionner', onClick: run, disabled: true }
  const menu = [
    { group: 'Create', options: [newFolder] },
    {
      group: 'Upload',
      options: [{ key: 'upload-files', label: 'Files', onClick: run }, uploadFolder],
    },
    selectAll,
  ]

  it('finds an option by its key, whatever its label says', () => {
    expect(menuCommand(menu, 'create-folder')).toBe(newFolder)
    expect(menuCommand(menu, 'upload-folder')).toBe(uploadFolder)
    expect(menuCommand(menu, 'select-all')).toBe(selectAll)
    expect(menuCommand(menu, 'share')).toBeUndefined()
  })
})
