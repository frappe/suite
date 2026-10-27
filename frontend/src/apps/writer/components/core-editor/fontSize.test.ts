import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { selectionFontSize, stepFontSize } from './fontSize'

let editor: Editor | null = null

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = 'h2 { font-size: 24px } p { font-size: 15px }'
  document.head.append(style)
})

function open(content: string) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: writerSchema(), content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('font size', () => {
  it('reads a heading at its own size and steps it from there', () => {
    const target = open('<h2>Goals</h2><p>Body</p>')
    target.commands.setTextSelection(3)
    expect(selectionFontSize(target)).toBe(24)

    target.commands.setTextSelection({ from: 1, to: 6 })
    stepFontSize(target, 1)
    expect(target.getHTML()).toContain('<span style="font-size: 25px;">Goals</span>')
  })

  it('steps each run from its own size, and drops a size equal to its block', () => {
    const target = open('<h2>Goals</h2><p><span style="font-size: 16px">Body</span></p>')
    target.commands.selectAll()
    stepFontSize(target, -1)
    const html = target.getHTML()
    expect(html).toContain('<span style="font-size: 23px;">Goals</span>')
    expect(html).toContain('<p>Body</p>')
  })
})
