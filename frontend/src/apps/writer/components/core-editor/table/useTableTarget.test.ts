import { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef, type EffectScope } from 'vue'

import { writerSchema } from '@/apps/writer/schema'

import { useTableTarget } from './useTableTarget'

let editor: Editor | null = null
let scope: EffectScope | null = null

const RECTS: Record<string, { left: number; top: number; width: number; height: number }> = {
  layer: { left: 20, top: 10, width: 0, height: 0 },
  wrapper: { left: 100, top: 50, width: 400, height: 120 },
  table: { left: 100, top: 50, width: 400, height: 120 },
  row: { left: 100, top: 90, width: 400, height: 40 },
  cell: { left: 200, top: 90, width: 100, height: 40 },
}

function rectOf(element: Element) {
  const kind = element.matches('[data-layer]')
    ? 'layer'
    : element.matches('.tableWrapper')
      ? 'wrapper'
      : element.tagName === 'TABLE'
        ? 'table'
        : element.tagName === 'TR'
          ? 'row'
          : 'cell'
  const { left, top, width, height } = RECTS[kind]
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(this) as DOMRect
  })
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
  // jsdom has no hit testing; the placeholder's viewport tracking asks for it once rects have a size
  Object.defineProperty(document, 'elementFromPoint', { value: () => null, configurable: true })
})

afterEach(() => {
  scope?.stop()
  scope = null
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'elementFromPoint')
})

const row = (tag: string, ...texts: string[]) =>
  `<tr>${texts.map((text) => `<${tag}><p>${text}</p></${tag}>`).join('')}</tr>`

function setup() {
  const element = document.body.appendChild(document.createElement('div'))
  const table = `<table>${row('th', 'Name', 'Role')}${row('td', 'Ann', 'Dev')}${row('td', 'Bo', 'Ops')}</table>`
  editor = new Editor({ element, extensions: writerSchema(), content: `<p>Intro</p>${table}` })
  const layer = document.body.appendChild(document.createElement('div'))
  layer.dataset.layer = ''
  scope = effectScope()
  const result = scope.run(() => useTableTarget(shallowRef(editor), ref(layer), () => false))
  if (!result) throw new Error('No target')
  return { editor, ...result }
}

function cellPos(target: Editor, text: string) {
  let found = -1
  target.state.doc.descendants((node, pos) => {
    const isCell = ['cell', 'header_cell'].includes(node.type.spec.tableRole)
    if (found < 0 && isCell && node.textContent === text) found = pos
  })
  return found
}

function hover(element: Element, clientX = 0, clientY = 0) {
  element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }))
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('table target', () => {
  it('follows the hovered cell, and measures the controls in the layer', async () => {
    const { editor, target, boxes } = setup()
    const cell = editor.view.nodeDOM(cellPos(editor, 'Dev')) as Element
    hover(cell.querySelector('p') ?? cell)
    await settle()

    expect(target.value).toEqual({
      cell: cellPos(editor, 'Dev'),
      row: 1,
      column: 1,
      kind: null,
      cellCount: 0,
      isMerged: false,
      hasHeaderRow: true,
    })
    expect(boxes.value).toEqual({
      table: { left: 80, top: 40, width: 400, height: 120 },
      row: { left: 80, top: 80, width: 400, height: 40 },
      column: { left: 180, top: 40, width: 100, height: 120 },
      selection: null,
      windowRight: 980,
    })
  })

  it('reports the caret when it is in the hovered cell', async () => {
    const { editor, target } = setup()
    const pos = cellPos(editor, 'Ann')
    editor.commands.setTextSelection(pos + 2)
    hover(editor.view.nodeDOM(pos) as Element)
    await settle()
    expect(target.value).toMatchObject({
      cell: pos,
      row: 1,
      column: 0,
      kind: 'caret',
      cellCount: 1,
    })
  })

  it('follows a run of selected cells over the hovered one', async () => {
    const { editor, target, boxes } = setup()
    hover(editor.view.nodeDOM(cellPos(editor, 'Name')) as Element)
    editor.commands.setCellSelection({
      anchorCell: cellPos(editor, 'Ann'),
      headCell: cellPos(editor, 'Dev'),
    })
    await settle()
    expect(target.value).toEqual({
      cell: cellPos(editor, 'Ann'),
      row: 1,
      column: 0,
      kind: 'row',
      cellCount: 2,
      isMerged: false,
      hasHeaderRow: true,
    })
    expect(boxes.value?.selection).toBeNull()

    editor.commands.setCellSelection({
      anchorCell: cellPos(editor, 'Dev'),
      headCell: cellPos(editor, 'Ops'),
    })
    await settle()
    expect(target.value).toMatchObject({ row: 1, column: 1, kind: 'cells', cellCount: 2 })
    expect(boxes.value?.selection).toEqual({ left: 180, top: 80, width: 100, height: 40 })
  })

  it('reports a merged cell', async () => {
    const { editor, target } = setup()
    editor.commands.setCellSelection({
      anchorCell: cellPos(editor, 'Ann'),
      headCell: cellPos(editor, 'Dev'),
    })
    editor.commands.mergeCells()
    const pos = cellPos(editor, 'AnnDev')
    hover(editor.view.nodeDOM(pos) as Element)
    await settle()
    expect(target.value).toMatchObject({ cell: pos, row: 1, column: 0, isMerged: true })
  })

  it('lets go of the cell when the pointer leaves the table, but not when it stays near', async () => {
    const { editor, target } = setup()
    hover(editor.view.nodeDOM(cellPos(editor, 'Bo')) as Element)
    await settle()
    expect(target.value?.row).toBe(2)

    hover(document.body, 520, 180)
    await settle()
    expect(target.value?.row).toBe(2)

    hover(document.body, 900, 600)
    await settle()
    expect(target.value).toBeNull()
  })
})
