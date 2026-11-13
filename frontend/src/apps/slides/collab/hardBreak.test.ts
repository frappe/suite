import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { convertLegacy } from './conversion'
import { elementText } from './deck'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const MAX_STATE = 4 * 1024 * 1024
// The shape the old editor saved: the same text style on the text and the break between it
const MARKED_BREAK = '<p><span style="font-size: 24px; color: rgb(255, 0, 0)">one<br>two</span></p>'
const editors: Editor[] = []

afterEach(() => {
  while (editors.length) {
    editors.pop()?.destroy()
  }
})

function convertedState() {
  const elements = [{ id: 'element', type: 'text', content: MARKED_BREAK }]
  const answer = convertLegacy({ slides: [{ id: 'slide', elements }] }, MAX_STATE)
  if (answer.kind !== 'converted') {
    throw new Error(JSON.stringify(answer))
  }

  return answer.state
}

// A tab with the real binding on one element's text
function open(state: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state, 'remote')
  const collaboration = Collaboration.configure({ fragment: elementText(doc, 'element') })
  const mount = document.createElement('div')
  document.body.append(mount)
  const editor = new Editor({ element: mount, extensions: [...extensions, collaboration] })
  editors.push(editor)
  return { doc, editor }
}

function breakMarks(editor: Editor) {
  const found: { name: string; attrs: Record<string, unknown> }[][] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'hardBreak') {
      found.push(node.marks.map(({ type, attrs }) => ({ name: type.name, attrs })))
    }
  })
  return found
}

const FONT_AND_COLOUR = [
  {
    name: 'textStyle',
    attrs: expect.objectContaining({ fontSize: '24px', color: 'rgb(255, 0, 0)' }),
  },
]

describe('a marked hard break in a converted deck', () => {
  it('shows its marks in a tab that opens the deck, and writes nothing', () => {
    const state = convertedState()
    const { doc, editor } = open(state)
    const writes = vi.fn()
    doc.on('update', (_update, origin) => writes(origin))

    expect(breakMarks(editor)).toEqual([FONT_AND_COLOUR])
    expect(writes).not.toHaveBeenCalled()
  })

  it('keeps its marks on the other tab through an edit next to it', () => {
    const state = convertedState()
    const one = open(state)
    const other = open(state)
    one.doc.on('update', (update, origin) => {
      if (origin !== 'remote') {
        Y.applyUpdate(other.doc, update, 'remote')
      }
    })

    one.editor.commands.insertContentAt(2, 'x')

    expect(other.editor.getText()).toContain('oxne')
    expect(breakMarks(other.editor)).toEqual([FONT_AND_COLOUR])
    expect(breakMarks(one.editor)).toEqual([FONT_AND_COLOUR])
  })
})
