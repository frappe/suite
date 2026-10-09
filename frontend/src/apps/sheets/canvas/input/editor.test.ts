import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEditor, type EditorOptions, type EditorOverlay, type LeaveMove } from './editor.js'

// A real <textarea> with overlay.js's show/hide/getValue behaviour, and stub
// picker/autocomplete that record calls.
function setup(over: Partial<EditorOptions> = {}) {
  document.body.innerHTML = ''
  const el = document.createElement('textarea')
  document.body.appendChild(el)
  const overlay: EditorOverlay = {
    el,
    position: vi.fn(),
    show(v) {
      el.value = v
      el.focus()
      el.setSelectionRange(v.length, v.length)
    },
    hide() {
      el.value = ''
    },
    getValue: () => el.value,
  }
  let keyPicking = false
  const picker = {
    isKeyPicking: () => keyPicking,
    keyStart: vi.fn(() => {
      keyPicking = true
    }),
    keyMove: vi.fn(),
    keyCommit: vi.fn(() => {
      keyPicking = false
    }),
    keyCancel: vi.fn(() => {
      keyPicking = false
    }),
    clear: vi.fn(),
  }
  const autocomplete = { update: vi.fn(), hide: vi.fn(), handleKey: vi.fn(() => false) }
  const commits: string[] = []
  const moves: LeaveMove[] = []
  const opts: EditorOptions = {
    overlay,
    picker,
    autocomplete,
    activeCell: () => ({ r: 2, c: 3 }),
    cellRect: () => ({ x: 10, y: 20, w: 100, h: 21 }),
    formatAt: () => ({}),
    getZoom: () => 2,
    canEdit: () => true,
    isCellEditable: () => true,
    onBlockedEdit: vi.fn(),
    collapseSelection: vi.fn(),
    ensureVisible: vi.fn(),
    onInput: vi.fn(),
    onCommit: (v) => {
      commits.push(v)
    },
    onCancel: vi.fn(),
    leave: (m) => {
      moves.push(m)
    },
    focusGrid: vi.fn(),
    render: vi.fn(),
    ...over,
  }
  const editor = createEditor(opts)
  const press = (key: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
  const type = (value: string) => {
    el.value = value
    el.setSelectionRange(value.length, value.length)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return { editor, el, opts, overlay, picker, autocomplete, commits, moves, press, type }
}

describe('opening', () => {
  it('shows the value, pins the textarea to the zoomed cell rect and collapses the selection', () => {
    const h = setup()
    h.editor.open('hi')
    expect(h.editor.isOpen()).toBe(true)
    expect(h.el.value).toBe('hi')
    expect(h.overlay.position).toHaveBeenCalledWith(20, 40, 200, 42, {}, 2)
    expect(h.opts.collapseSelection).toHaveBeenCalled()
    expect(h.opts.ensureVisible).toHaveBeenCalledWith(2, 3)
    expect(h.opts.onInput).toHaveBeenCalledWith('hi')
  })

  it('stays closed for a viewer', () => {
    const h = setup({ canEdit: () => false })
    h.editor.open('x')
    expect(h.editor.isOpen()).toBe(false)
  })

  it('reports a protected cell instead of opening', () => {
    const h = setup({ isCellEditable: () => false })
    h.editor.open('x')
    expect(h.editor.isOpen()).toBe(false)
    expect(h.opts.onBlockedEdit).toHaveBeenCalled()
  })

  it('reposition is a no-op while closed', () => {
    const h = setup()
    h.editor.reposition()
    expect(h.overlay.position).not.toHaveBeenCalled()
  })
})

describe('keys', () => {
  let h: ReturnType<typeof setup>
  beforeEach(() => {
    h = setup()
  })

  it('Enter commits and moves down', () => {
    h.editor.open('')
    h.type('42')
    h.press('Enter')
    expect(h.commits).toEqual(['42'])
    expect(h.moves).toEqual([{ kind: 'enter' }])
    expect(h.editor.isOpen()).toBe(false)
    expect(h.opts.focusGrid).toHaveBeenCalled()
  })

  it('Ctrl+Enter inserts a newline instead of committing', () => {
    h.editor.open('ab')
    h.el.setSelectionRange(1, 1)
    h.press('Enter', { ctrlKey: true })
    expect(h.el.value).toBe('a\nb')
    expect(h.commits).toEqual([])
  })

  it('Tab and Shift+Tab commit and move sideways', () => {
    h.editor.open('a')
    h.press('Tab')
    h.editor.open('b')
    h.press('Tab', { shiftKey: true })
    expect(h.moves).toEqual([
      { kind: 'tab', back: false },
      { kind: 'tab', back: true },
    ])
  })

  it('Escape cancels without committing', () => {
    h.editor.open('draft')
    h.press('Escape')
    expect(h.commits).toEqual([])
    expect(h.opts.onCancel).toHaveBeenCalled()
    expect(h.editor.isOpen()).toBe(false)
  })

  it('in enter mode an arrow commits plain text and moves', () => {
    h.editor.open('5')
    h.press('ArrowRight')
    expect(h.commits).toEqual(['5'])
    expect(h.moves).toEqual([{ kind: 'arrow', dr: 0, dc: 1 }])
  })

  it('in edit mode arrows are left to the caret', () => {
    h.editor.open('5', 'edit')
    h.press('ArrowRight')
    expect(h.commits).toEqual([])
    expect(h.editor.isOpen()).toBe(true)
  })

  it('in a formula an arrow starts a pick, the next one moves it', () => {
    h.editor.open('=')
    h.press('ArrowDown')
    expect(h.picker.keyStart).toHaveBeenCalledWith(h.el, 1, 0, false)
    h.press('ArrowDown', { shiftKey: true })
    expect(h.picker.keyMove).toHaveBeenCalledWith(1, 0, true, false)
    expect(h.commits).toEqual([])
  })

  it('in a formula where no reference can go, an arrow moves the caret', () => {
    h.editor.open('=SUM')
    const notCancelled = h.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    )
    expect(notCancelled).toBe(true) // the browser moves the caret
    expect(h.picker.keyStart).not.toHaveBeenCalled()
    expect(h.commits).toEqual([])
    expect(h.editor.isOpen()).toBe(true)
  })

  it('Escape while picking cancels the pick and keeps editing', () => {
    h.editor.open('=')
    h.press('ArrowDown')
    h.press('Escape')
    expect(h.picker.keyCancel).toHaveBeenCalled()
    expect(h.editor.isOpen()).toBe(true)
  })

  it('typing ( in a formula auto-closes it', () => {
    h.editor.open('=SUM')
    h.press('(')
    expect(h.el.value).toBe('=SUM()')
    expect(h.el.selectionStart).toBe(5)
  })

  it('a key the autocomplete used goes no further', () => {
    h.autocomplete.handleKey.mockReturnValueOnce(true)
    h.editor.open('=SU')
    h.press('Enter')
    expect(h.commits).toEqual([])
    expect(h.editor.isOpen()).toBe(true)
  })

  it('typing feeds the host and the autocomplete', () => {
    h.editor.open('')
    h.type('=S')
    expect(h.opts.onInput).toHaveBeenLastCalledWith('=S')
    expect(h.autocomplete.update).toHaveBeenLastCalledWith('=S', 2)
  })
})

describe('switching modes', () => {
  let h: ReturnType<typeof setup>
  beforeEach(() => {
    h = setup()
  })

  it('F2 in enter mode hands the arrows to the caret', () => {
    h.editor.open('=')
    h.press('F2')
    h.press('ArrowDown')
    expect(h.picker.keyStart).not.toHaveBeenCalled()
    expect(h.editor.isOpen()).toBe(true)
  })

  it('F2 again goes back to picking references', () => {
    h.editor.open('=', 'edit')
    h.press('F2')
    h.press('ArrowDown')
    expect(h.picker.keyStart).toHaveBeenCalledWith(h.el, 1, 0, false)
  })

  it('F2 while picking keeps the reference and ends the pick', () => {
    h.editor.open('=')
    h.press('ArrowDown')
    h.press('F2')
    expect(h.picker.keyCommit).toHaveBeenCalled()
    h.press('ArrowDown')
    expect(h.picker.keyMove).not.toHaveBeenCalled()
  })

  it('Shift+F2 does not switch modes', () => {
    h.editor.open('5')
    h.press('F2', { shiftKey: true })
    h.press('ArrowRight')
    expect(h.commits).toEqual(['5'])
  })

  it('a click in the text switches to edit mode', () => {
    h.editor.open('5')
    h.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    h.press('ArrowRight')
    expect(h.commits).toEqual([])
    expect(h.editor.isOpen()).toBe(true)
  })
})

describe('blur', () => {
  it('commits what was typed', () => {
    const h = setup()
    h.editor.open('')
    h.type('x')
    h.el.dispatchEvent(new Event('blur'))
    expect(h.commits).toEqual(['x'])
    expect(h.editor.isOpen()).toBe(false)
  })

  it('does nothing once already committed', () => {
    const h = setup()
    h.editor.open('x')
    h.editor.commit()
    h.el.dispatchEvent(new Event('blur'))
    expect(h.commits).toEqual(['x'])
  })
})
