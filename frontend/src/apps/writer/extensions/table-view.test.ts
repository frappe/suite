import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { WriterTableView } from './table-view'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function tableWithWidth(width: number | null): PMNode {
  const colwidth = width === null ? '' : ` colwidth="${width}"`
  editor?.destroy()
  editor = new Editor({
    extensions: writerSchema(),
    content: `<table><tr><td${colwidth}><p>a</p></td><td><p>b</p></td></tr></table>`,
  })
  const table = editor.state.doc.firstChild
  if (!table) throw new Error('No table')
  return table
}

it('gives a column its even width back when its width is removed, as after undoing a resize', () => {
  const view = new WriterTableView(tableWithWidth(160), 25)
  const firstColumn = view.colgroup.firstElementChild as HTMLElement
  expect(firstColumn.style.width).toBe('160px')

  view.update(tableWithWidth(null))
  expect(firstColumn.style.width).toBe('')
})
