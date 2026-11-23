import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, expect, it, vi } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'
import { requireTestElement } from '@/platform/testing/dom'

import { DEFAULT_COLUMN_WIDTH, WriterTableView } from './table-view'

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
  const firstColumn = requireTestElement(view.colgroup.firstElementChild, HTMLElement)
  expect(firstColumn.style.width).toBe('160px')

  view.update(tableWithWidth(null))
  expect(firstColumn.style.width).toBe('')
})

it('keeps columns without a width at the default width, so a wide table scrolls', () => {
  const view = new WriterTableView(tableWithWidth(null), 25)
  expect(view.table.style.minWidth).toBe(`${2 * DEFAULT_COLUMN_WIDTH}px`)
})

it('draws a column resized below the default width at that width', () => {
  const view = new WriterTableView(tableWithWidth(70), 25)
  const firstColumn = requireTestElement(view.colgroup.firstElementChild, HTMLElement)
  expect(firstColumn.style.width).toBe('70px')
  expect(view.table.style.minWidth).toBe(`${70 + DEFAULT_COLUMN_WIDTH}px`)
})

it('keeps the other columns at the default width while one is being resized', async () => {
  const view = new WriterTableView(tableWithWidth(null), 25)
  const firstColumn = requireTestElement(view.colgroup.firstElementChild, HTMLElement)
  // What the resize plugin writes during a drag, measuring the other column by its drag limit
  firstColumn.style.width = '70px'
  view.table.style.minWidth = '95px'
  await vi.waitFor(() => expect(view.table.style.minWidth).toBe(`${70 + DEFAULT_COLUMN_WIDTH}px`))
})

it('fades only the sides that have more to scroll to', () => {
  const view = new WriterTableView(tableWithWidth(null), 25)
  document.body.append(view.dom)
  const sizes = (scrollLeft: number, scrollWidth: number) => {
    Object.defineProperties(view.dom, {
      clientWidth: { value: 300, configurable: true },
      scrollWidth: { value: scrollWidth, configurable: true },
      scrollLeft: { value: scrollLeft, configurable: true },
    })
    view.dom.dispatchEvent(new Event('scroll'))
    return [
      view.dom.classList.contains('has-more-before'),
      view.dom.classList.contains('has-more-after'),
    ]
  }

  expect(sizes(0, 300)).toEqual([false, false])
  expect(sizes(0, 600)).toEqual([false, true])
  expect(sizes(150, 600)).toEqual([true, true])
  expect(sizes(300, 600)).toEqual([true, false])
  view.destroy()
  view.dom.remove()
})
