import { Editor } from '@tiptap/core'
import { afterEach, expect, it, vi } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { closeTableSizePicker, openTableSizePicker } from './tableSizePicker'

// The test build of frappe-ui has no Popover; this one shows its content in place
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const Popover = defineComponent(
    (_props, { slots }) =>
      () =>
        h('div', [slots.trigger?.(), slots.default?.()]),
  )
  return { Popover }
})

let editor: Editor | null = null
afterEach(() => {
  closeTableSizePicker()
  editor?.destroy()
  editor = null
})

it('inserts a table of the size picked on the grid, with a header row', async () => {
  const element = document.body.appendChild(document.createElement('div'))
  editor = new Editor({ element, extensions: writerSchema(), content: '<p>Intro</p>' })
  // jsdom has no layout
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 16 })
  openTableSizePicker(editor)

  const cell = await vi.waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="2 × 4"]')
    if (!button) throw new Error('The grid is not open')
    return button
  })
  cell.click()

  let table = editor.state.doc
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') table = node
  })
  expect(table.type.name).toBe('table')
  expect(table.childCount).toBe(2)
  expect(table.firstChild?.childCount).toBe(4)
  expect(table.firstChild?.firstChild?.type.name).toBe('tableHeader')
  expect(document.querySelector('[data-slot="table-size-picker"]')).toBeNull()
})
