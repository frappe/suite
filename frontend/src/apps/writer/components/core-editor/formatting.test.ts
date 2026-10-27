import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { activeBlockStyle, BLOCK_STYLES, formatShortcut, toggleHighlight } from './formatting'

let editor: Editor | null = null

function open(content: string) {
  editor = new Editor({ extensions: writerSchema(), content })
  editor.commands.setTextSelection(3)
  return editor
}

function turnInto(target: Editor, label: string) {
  const style = BLOCK_STYLES.find((block) => block.label === label)
  if (!style) throw new Error(`No block style named ${label}`)
  style.apply(target.chain().focus()).run()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('block styles', () => {
  it('names a list by its list, not by the paragraph inside the item', () => {
    expect(activeBlockStyle(open('<ul><li><p>First</p></li></ul>')).label).toBe('Bulleted list')
    expect(activeBlockStyle(open('<ol><li><p>First</p></li></ol>')).label).toBe('Numbered list')
    expect(activeBlockStyle(open('<h2>Goals</h2>')).label).toBe('Heading 2')
    expect(activeBlockStyle(open('<p>Plain</p>')).label).toBe('Text')
  })

  it('turns a list item into plain text outside the list', () => {
    const target = open('<ul><li><p>First</p></li></ul>')
    turnInto(target, 'Text')
    expect(target.getHTML()).toBe('<p>First</p>')
  })

  it('turns a quoted line into a heading outside the quote', () => {
    const target = open('<blockquote><p>Details</p></blockquote>')
    turnInto(target, 'Heading 1')
    expect(target.getHTML()).toMatch(/^<h1[^>]*>Details<\/h1>$/)
  })

  it('switches a bulleted list to a numbered one', () => {
    const target = open('<ul><li><p>First</p></li></ul>')
    turnInto(target, 'Numbered list')
    expect(target.getHTML()).toMatch(/^<ol[^>]*><li><p>First<\/p><\/li><\/ol>$/)
  })
})

describe('shortcuts', () => {
  it('writes a key binding the way the platform shows it', () => {
    expect(formatShortcut('Mod-Shift-s', false)).toBe('Ctrl+Shift+S')
    expect(formatShortcut('Mod-Shift-s', true)).toBe('⌘⇧S')
  })
})

describe('highlight', () => {
  it('removes any colour when on, and keeps the selection either way', () => {
    const target = open(
      '<p><mark style="background-color: var(--prose-highlight-red)">Red</mark> plain</p>',
    )
    target.commands.setTextSelection({ from: 1, to: 4 })
    toggleHighlight(target)
    expect(target.getHTML()).toBe('<p>Red plain</p>')

    toggleHighlight(target)
    expect(target.isActive('namedHighlight', { color: 'yellow' })).toBe(true)
    expect(target.state.selection).toMatchObject({ from: 1, to: 4 })
  })
})
