// URL auto-linking on paste — plain-text whole-cell URLs and <a href> anchors
// from clipboard HTML both land as fmt.hyperlink. jsdom (the suite vitest env)
// supplies DOMParser for the HTML-table path.
import { beforeEach, describe, expect, it } from 'vitest'

import { createClipboard } from './clipboard.js'

function makeSheet(initial = {}) {
  const store = { ...initial }
  return {
    getRawData: () => store,
    getCell: (id) => store[id] ?? '',
    setCell: (id, v) => {
      store[id] = v
    },
    getCurrentSheet: () => 'Sheet1',
    getDisplayValue: (id) => store[id] ?? '',
    _store: () => store,
  }
}

function makeFormats() {
  const store = {}
  return {
    get: (id) => store[id] ?? {},
    set: (id, fmt) => {
      store[id] = { ...(store[id] || {}), ...fmt }
    },
    clear: (id) => {
      delete store[id]
    },
    _store: () => store,
  }
}

describe('clipboard — pasteFromText auto-links whole-cell URLs', () => {
  let sheet, formats, cb
  beforeEach(() => {
    sheet = makeSheet()
    formats = makeFormats()
    cb = createClipboard({ sheet, formats })
  })

  it('sets fmt.hyperlink for URL cells, leaves plain text alone', () => {
    cb.pasteFromText('https://frappe.io/\tplain text\nfrappe.io\t42', 'A1', null)
    const f = formats._store()
    expect(sheet._store().A1).toBe('https://frappe.io/')
    expect(f.A1).toEqual({ hyperlink: 'https://frappe.io/' })
    expect(f.B1).toBeUndefined()
    expect(f.A2).toEqual({ hyperlink: 'https://frappe.io' }) // bare domain normalized
    expect(f.B2).toBeUndefined()
  })

  it('tiled single-URL paste links every destination cell', () => {
    cb.pasteFromText('www.frappe.io', 'A1', null, { r0: 0, c0: 0, r1: 1, c1: 0 })
    const f = formats._store()
    expect(f.A1).toEqual({ hyperlink: 'https://www.frappe.io' })
    expect(f.A2).toEqual({ hyperlink: 'https://www.frappe.io' })
  })

  it('does not link when no formats engine is wired (headless paste)', () => {
    const bare = createClipboard({ sheet: makeSheet() })
    expect(bare.pasteFromText('https://frappe.io/', 'A1', null)).toBe(true)
  })

  it('clears a stale hyperlink when plain text overwrites a linked cell', () => {
    formats.set('A1', { hyperlink: 'https://old.example.com' })
    cb.pasteFromText('just text', 'A1', null)
    expect(sheet._store().A1).toBe('just text')
    expect(formats._store().A1).toEqual({ hyperlink: null })
  })

  it('leaves formats untouched when plain text lands on an unlinked cell', () => {
    cb.pasteFromText('plain', 'A1', null)
    expect(formats._store().A1).toBeUndefined()
  })
})

describe('clipboard — pasteFromHTML keeps <a href> linkness', () => {
  it('maps anchor targets onto fmt.hyperlink with the anchor text as value', () => {
    const sheet = makeSheet()
    const formats = makeFormats()
    const cb = createClipboard({ sheet, formats })
    const html =
      '<table><tr>' +
      '<td><a href="https://frappe.io/">Frappe</a></td>' +
      '<td>no link</td></tr></table>'
    expect(cb.pasteFromHTML(html, 'A1', null)).toBe(true)
    expect(sheet._store().A1).toBe('Frappe')
    expect(formats._store().A1).toEqual({ hyperlink: 'https://frappe.io/' })
    expect(formats._store().B1).toBeUndefined()
  })

  it('ignores javascript: anchors but still auto-links URL-shaped text', () => {
    const sheet = makeSheet()
    const formats = makeFormats()
    const cb = createClipboard({ sheet, formats })
    const html =
      '<table><tr>' +
      '<td><a href="javascript:alert(1)">click</a></td>' +
      '<td>https://frappe.io/</td></tr></table>'
    cb.pasteFromHTML(html, 'A1', null)
    expect(formats._store().A1).toBeUndefined()
    expect(formats._store().B1).toEqual({ hyperlink: 'https://frappe.io/' })
  })
})
