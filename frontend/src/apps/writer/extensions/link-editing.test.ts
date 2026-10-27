import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { bubbleMenuShouldShow } from '@/apps/writer/components/core-editor/bubble-menu'
import { writerSchema } from '@/apps/writer/schema'

import { applyLink, isEditingLink, LinkEditing, normalizeHref, removeLink } from './link-editing'

let editor: Editor | null = null

function open(content: string) {
  editor = new Editor({ extensions: [...writerSchema(), LinkEditing], content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('link editing', () => {
  it('opens on the whole link the caret is in, and hides the selection bubble menu', () => {
    const target = open('<p>Read <a href="https://frappe.io">the docs</a> first</p>')
    target.commands.setTextSelection(10)
    target.commands.openLinkEditor()

    const { from, to } = target.state.selection
    expect(target.state.doc.textBetween(from, to)).toBe('the docs')
    expect(isEditingLink(target.state)).toBe(true)
    const shouldShow = bubbleMenuShouldShow()
    expect(shouldShow({ state: target.state, from, to })).toBe(false)
  })

  it('stops editing when the caret moves elsewhere', () => {
    const target = open('<p>Read <a href="https://frappe.io">the docs</a> first</p>')
    target.commands.setTextSelection(10)
    target.commands.openLinkEditor()
    target.commands.setTextSelection(2)
    expect(isEditingLink(target.state)).toBe(false)
  })

  it('links selected text and inserts a typed address at a bare caret', () => {
    const target = open('<p>Read the docs</p>')
    target.commands.setTextSelection({ from: 6, to: 14 })
    applyLink(target, 'https://frappe.io')
    target.commands.setTextSelection(1)
    applyLink(target, '/d/abc')

    expect(target.getHTML()).toContain(
      '<a target="_blank" rel="noopener noreferrer nofollow" href="/d/abc">/d/abc</a>Read',
    )
    expect(target.getHTML()).toContain('href="https://frappe.io">the docs</a>')
  })

  it('removes the link the caret is in and keeps its text', () => {
    const target = open('<p>Read <a href="https://frappe.io">the docs</a> first</p>')
    target.commands.setTextSelection(10)
    removeLink(target)
    expect(target.getHTML()).toBe('<p>Read the docs first</p>')
    expect(target.state.selection.from).toBe(10)
  })

  it('accepts web, mail and phone links and paths, and adds https to a bare host', () => {
    expect(normalizeHref('frappe.io')).toBe('https://frappe.io')
    expect(normalizeHref('mailto:a@b.co')).toBe('mailto:a@b.co')
    expect(normalizeHref('/d/abc')).toBe('/d/abc')
    expect(normalizeHref('notalink')).toBeNull()
    expect(normalizeHref('javascript:alert(1)')).toBeNull()
  })
})
