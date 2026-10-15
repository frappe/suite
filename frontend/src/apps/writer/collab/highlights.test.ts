import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import type { DocumentThread } from '@/apps/drive'

import { encodeAnchor } from './anchors'
import { redrawThreads, ThreadHighlights, type ThreadPlaces } from './highlights'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function openEditor(
  doc: Y.Doc,
  threads: { list: DocumentThread[] },
  placed: (places: ThreadPlaces) => void = () => {},
) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: doc }),
      ThreadHighlights.configure({ threads: () => threads.list, placed }),
    ],
  })
  editors.push(editor)
  return editor
}

function threadOn(doc: Y.Doc, name: string, start: number, end: number, isResolved = false) {
  const text = (doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
  const from = Y.createRelativePositionFromTypeIndex(text, start, 0)
  const to = Y.createRelativePositionFromTypeIndex(text, end, -1)
  const anchor = encodeAnchor(from, to, '')
  return { name, anchor, resolved: isResolved } as DocumentThread
}

function highlighted(editor: Editor) {
  const spans = editor.view.dom.querySelectorAll('[data-thread]')
  return [...spans].map((span) => {
    const name = span.getAttribute('data-thread')
    return `${name}:${span.textContent}`
  })
}

describe('thread highlights', () => {
  it('marks each open thread once the threads are read, and leaves resolved ones plain', () => {
    const doc = new Y.Doc()
    const threads = { list: [] as DocumentThread[] }
    const editor = openEditor(doc, threads)
    editor.commands.setContent('<p>hello world</p>')

    threads.list = [threadOn(doc, 'open', 0, 5), threadOn(doc, 'done', 6, 11, true)]
    const beforeRedraw = highlighted(editor)
    redrawThreads(editor.view)

    expect(beforeRedraw).toEqual([])
    expect(highlighted(editor)).toEqual(['open:hello'])
  })

  it("moves with another tab's edit", () => {
    const doc = new Y.Doc()
    const threads = { list: [] as DocumentThread[] }
    const editor = openEditor(doc, threads)
    editor.commands.setContent('<p>hello world</p>')
    threads.list = [threadOn(doc, 'open', 6, 11)]
    redrawThreads(editor.view)

    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
    const before = Y.encodeStateVector(remote)
    ;((remote.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(
      0,
      'oh, ',
    )
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, before))

    expect([editor.getText(), highlighted(editor)]).toEqual(['oh, hello world', ['open:world']])
  })

  it('tells the app where each thread is whenever the threads or the text change', () => {
    const doc = new Y.Doc()
    const threads = { list: [] as DocumentThread[] }
    const told: string[][] = []
    function placed(places: ThreadPlaces) {
      told.push([...places].map(([name, place]) => `${name}:${place.kind}`))
    }

    const editor = openEditor(doc, threads, placed)
    editor.commands.setContent('<p>hello world</p>')
    threads.list = [threadOn(doc, 'open', 6, 11)]
    redrawThreads(editor.view)
    editor.commands.setTextSelection(1)
    editor.commands.deleteRange({ from: 7, to: 12 })

    expect(told).toEqual([[], [], ['open:text'], ['open:deleted']])
  })
})
