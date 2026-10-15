import { Editor, Extension } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Plugin, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it } from 'vitest'

import { SteadyCaret } from './steady-caret'

const LINE = 20
const FRACTIONAL_LINE = 22.5
const HALF_PIXEL = 0.5
const EDITS = 10
const FIRST_LINE_TOP = 100
const SCROLLER_HEIGHT = 450
const START_SCROLL = 50
const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }

  document.body.replaceChildren()
})

// Like thread highlights, answers every doc change with a transaction of its own
const Echo = Extension.create({
  name: 'echo',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: () => ({
          update(view: EditorView, previous: EditorState) {
            if (previous.doc.eq(view.state.doc)) return

            view.dispatch(view.state.tr.setMeta('echo', true))
          },
        }),
      }),
    ]
  },
})

// jsdom has no layout, so each paragraph is one line and the scroller is as tall as its content
async function openEditor(scrollTop: number, line = LINE) {
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  const element = document.createElement('div')
  scroller.append(element)
  document.body.append(scroller)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, Echo, SteadyCaret],
    content: '<p>one</p><p>two</p><p>three</p><p>four</p>',
  })
  editors.push(editor)
  const view = editor.view
  function coordsAtPos(pos: number) {
    const top = FIRST_LINE_TOP + line * view.state.doc.resolve(pos).index(0) - scroller.scrollTop
    return { top, bottom: top + line, left: 0, right: 0 }
  }

  view.coordsAtPos = coordsAtPos
  // Like a browser at one device pixel per CSS pixel, the scroller keeps whole pixels
  let scrolled = scrollTop
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrolled,
    set: (value: number) => {
      scrolled = Math.round(value)
    },
  })
  Object.defineProperty(scroller, 'clientHeight', { value: SCROLLER_HEIGHT })
  Object.defineProperty(scroller, 'scrollHeight', {
    get: () => FIRST_LINE_TOP * view.state.doc.childCount,
  })
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 0, SCROLLER_HEIGHT)
  editor.commands.setTextSelection(view.state.doc.content.size - 1)
  await new Promise((resolve) => editor.once('create', resolve))
  return { editor, scroller }
}

function othersAddLineAtTop(editor: Editor) {
  const paragraph = editor.schema.nodes.paragraph.create(null, editor.schema.text('new'))
  const transaction = editor.state.tr.insert(0, paragraph)
  editor.view.dispatch(transaction.setMeta(ySyncPluginKey, { isChangeOrigin: true }))
}

function ownLineTop(editor: Editor) {
  return editor.view.coordsAtPos(editor.state.selection.head).top
}

describe('SteadyCaret', () => {
  it("keeps the own line in place when a plugin answers others' edit", async () => {
    const { editor } = await openEditor(START_SCROLL)
    const before = ownLineTop(editor)

    othersAddLineAtTop(editor)

    expect(ownLineTop(editor)).toBe(before)
  })

  it("keeps the own line in place when others' edit is what makes the doc scroll", async () => {
    const { editor, scroller } = await openEditor(0)
    const before = ownLineTop(editor)

    othersAddLineAtTop(editor)

    expect(scroller.scrollTop).toBe(LINE)
    expect(ownLineTop(editor)).toBe(before)
  })

  it('keeps the own line in place through many edits when lines are a fraction of a pixel tall', async () => {
    const { editor } = await openEditor(START_SCROLL, FRACTIONAL_LINE)
    const before = ownLineTop(editor)

    for (let edit = 0; edit < EDITS; edit++) {
      othersAddLineAtTop(editor)
    }

    expect(Math.abs(ownLineTop(editor) - before)).toBeLessThanOrEqual(HALF_PIXEL)
  })
})
