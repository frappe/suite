import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { setTweaks } from '@/platform/tweaks'

import { getShortcutGroups } from '../../../../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut'
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
function listing(offered: ListingCommands, signedIn = true, inTrash = false) {
  const opened: ListingView[] = []
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(
    defineComponent({
      setup() {
        useListingShortcuts(
          () => offered,
          { enabled: () => signedIn, open: (view) => opened.push(view) },
          { inTrash: () => inTrash },
        )
        return () =>
          h('div', [
            h('input', { 'aria-label': 'Search' }),
            h('div', { role: 'dialog' }, [h('button', 'Inside a dialog')]),
            h('div', { role: 'menu' }, [h('button', { role: 'menuitem' }, 'Rename')]),
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

describe('Delete, F2, parent folder and Undo keys', () => {
  afterEach(() =>
    setTweaks(['t14-delete-key', 't14-rename-key', 't14-parent-key', 't14-undo-key'], true),
  )

  it('removes with Delete and Mod+Backspace, renames with F2 and opens the parent with Alt+Up', () => {
    const remove = { onClick: vi.fn() }
    const rename = { onClick: vi.fn() }
    const parent = { onClick: vi.fn() }
    listing({ remove, rename, parent })

    press('Delete')
    press('Backspace', { ctrlKey: true })
    press('F2')
    const up = press('ArrowUp', { altKey: true })

    expect(remove.onClick).toHaveBeenCalledTimes(2)
    expect(rename.onClick).toHaveBeenCalledOnce()
    expect(parent.onClick).toHaveBeenCalledOnce()
    expect(up.defaultPrevented).toBe(true)
  })

  it('ignores a held key and a key pressed in an open menu', () => {
    const remove = { onClick: vi.fn() }
    const rename = { onClick: vi.fn() }
    listing({ remove, rename })

    press('Delete', { repeat: true })
    press('Delete', {}, document.querySelector('[role="menuitem"]')!)
    press('F2', {}, document.querySelector('[role="menuitem"]')!)

    expect(remove.onClick).not.toHaveBeenCalled()
    expect(rename.onClick).not.toHaveBeenCalled()
  })

  it('keeps Mod+Z for the browser when there is nothing to undo', () => {
    let undoable = true
    const undo = vi.fn(() => undoable)
    listing({ undo })

    expect(press('z', { ctrlKey: true }).defaultPrevented).toBe(true)
    undoable = false
    expect(press('z', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(undo).toHaveBeenCalledTimes(2)
  })

  it('names the delete keys by what they do, in Trash and elsewhere', () => {
    listing({})
    expect(listed()).toContain('Move selected items to Trash')
    cleanup?.()
    listing({}, true, true)
    expect(listed()).toContain('Delete selected items forever')
    expect(listed()).not.toContain('Move selected items to Trash')
  })

  it('switched off, Delete, F2 and Mod+Z do nothing and Mod+Backspace keeps its old name', () => {
    setTweaks(['t14-delete-key', 't14-rename-key', 't14-parent-key', 't14-undo-key'], false)
    const remove = { onClick: vi.fn() }
    const rename = { onClick: vi.fn() }
    const undo = vi.fn(() => true)
    listing({ remove, rename, undo })

    press('Delete')
    press('F2')
    press('z', { ctrlKey: true })
    press('Backspace', { ctrlKey: true })

    expect(rename.onClick).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    expect(remove.onClick).toHaveBeenCalledOnce()
    expect(listed()).toContain('Delete selected items')
    expect(listed()).not.toContain('Rename')
  })
})

/** The descriptions the shortcuts dialog lists. */
function listed() {
  return getShortcutGroups().flatMap((group) => group.shortcuts.map((entry) => entry.description))
}

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
