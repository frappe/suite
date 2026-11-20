import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { writerSlashItems } from './slash-commands'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function titles(query: string) {
  editor = new Editor({ extensions: writerSchema(), content: '<p>/</p>' })
  return writerSlashItems(editor, [], query).map((item) => item.title)
}

describe('slash menu', () => {
  it('offers every heading level and text, as the style select does', () => {
    expect(titles('head')).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4'])
    expect(titles('text')).toEqual(['Text'])
  })

  it('uses the toolbar names for blocks and offers page breaks', () => {
    expect(titles('list')).toEqual(['Bulleted list', 'Numbered list', 'To-do list'])
    expect(titles('page')).toEqual(['Page break'])
    expect(titles('')).toEqual(expect.arrayContaining(['Code block', 'Quote', 'Divider', 'Table']))
  })

  it('turns the line into the picked block', () => {
    editor = new Editor({ extensions: writerSchema(), content: '<p>/head</p>' })
    const heading = writerSlashItems(editor, [], 'heading 1')[0]
    heading.command({ editor, range: { from: 1, to: 6 } })
    expect(editor.getHTML()).toMatch(/^<h1[^>]*><\/h1>$/)
  })
})
