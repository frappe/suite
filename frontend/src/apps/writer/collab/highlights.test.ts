import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import type { DocumentThread } from '@/apps/drive'

import { encodeAnchor } from './anchors'
import { redrawThreads, showThread, ThreadHighlights, type ThreadPlaces } from './highlights'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

interface Panel {
  open: string | null
  lit: string | null
  opened: string[]
}

function openEditor(
  doc: yjs.Doc,
  threads: { list: DocumentThread[] },
  placed: (places: ThreadPlaces) => void = () => {},
  panel: Panel = { open: null, lit: null, opened: [] },
) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: doc }),
      ThreadHighlights.configure({
        threads: () => threads.list,
        onPlaced: placed,
        open: () => panel.open,
        lit: () => panel.lit,
        onOpened: (name) => panel.opened.push(name),
      }),
    ],
  })
  editors.push(editor)
  return editor
}

function threadOn(doc: yjs.Doc, name: string, start: number, end: number, isResolved = false) {
  const text = (doc.getXmlFragment('default').get(0) as yjs.XmlElement).get(0) as yjs.XmlText
  const from = yjs.createRelativePositionFromTypeIndex(text, start, 0)
  const to = yjs.createRelativePositionFromTypeIndex(text, end, -1)
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
    const doc = new yjs.Doc()
    const threads = { list: [] as DocumentThread[] }
    const editor = openEditor(doc, threads)
    editor.commands.setContent('<p>hello world</p>')

    threads.list = [threadOn(doc, 'open', 0, 5), threadOn(doc, 'done', 6, 11, true)]
    const beforeRedraw = highlighted(editor)
    redrawThreads(editor.view)

    expect(beforeRedraw).toEqual([])
    expect(highlighted(editor)).toEqual(['open:hello'])
  })

  it('drops the highlight of a thread gone from the list and leaves the text as it was', () => {
    const doc = new yjs.Doc()
    const threads = { list: [] as DocumentThread[] }
    const editor = openEditor(doc, threads)
    editor.commands.setContent('<p>hello world</p>')
    threads.list = [threadOn(doc, 'kept', 0, 5), threadOn(doc, 'deleted', 6, 11)]
    redrawThreads(editor.view)
    const before = [editor.getText(), JSON.stringify(editor.getJSON())]

    threads.list = threads.list.slice(0, 1)
    redrawThreads(editor.view)

    expect([highlighted(editor), editor.getText(), JSON.stringify(editor.getJSON())]).toEqual([
      ['kept:hello'],
      ...before,
    ])
  })

  it("moves with another tab's edit", () => {
    const doc = new yjs.Doc()
    const threads = { list: [] as DocumentThread[] }
    const editor = openEditor(doc, threads)
    editor.commands.setContent('<p>hello world</p>')
    threads.list = [threadOn(doc, 'open', 6, 11)]
    redrawThreads(editor.view)

    const remote = new yjs.Doc()
    yjs.applyUpdate(remote, yjs.encodeStateAsUpdate(doc))
    const before = yjs.encodeStateVector(remote)
    ;((remote.getXmlFragment('default').get(0) as yjs.XmlElement).get(0) as yjs.XmlText).insert(
      0,
      'oh, ',
    )
    yjs.applyUpdate(doc, yjs.encodeStateAsUpdate(remote, before))

    expect([editor.getText(), highlighted(editor)]).toEqual(['oh, hello world', ['open:world']])
  })

  it('tells the app where each thread is whenever the threads or the text change', () => {
    const doc = new yjs.Doc()
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

describe('the text of the thread the panel points at', () => {
  // An editor on "hello world" with a thread on each word
  function twoThreads() {
    const doc = new yjs.Doc()
    const threads = { list: [] as DocumentThread[] }
    const panel: Panel = { open: null, lit: null, opened: [] }
    const editor = openEditor(doc, threads, () => {}, panel)
    editor.commands.setContent('<p>hello world</p>')
    threads.list = [threadOn(doc, 'first', 0, 5), threadOn(doc, 'second', 6, 11)]
    redrawThreads(editor.view)
    return { editor, panel }
  }

  function shown(editor: Editor) {
    const spans = editor.view.dom.querySelectorAll('[data-thread]')
    return [...spans].map((span) => `${span.textContent}:${span.className}`)
  }

  it('shows the open thread darker and a pointed-at one lighter, once redrawn', () => {
    const { editor, panel } = twoThreads()

    panel.open = 'first'
    panel.lit = 'second'
    redrawThreads(editor.view)

    expect([shown(editor), editor.state.selection.empty]).toEqual([
      ['hello:is-open', 'world:is-lit'],
      true,
    ])
  })

  it('opens the thread whose highlighted text is clicked, and nothing for plain text', () => {
    const { editor, panel } = twoThreads()
    const world = editor.view.dom.querySelector('[data-thread="second"]')!

    editor.view.someProp('handleClick', (click) =>
      click(editor.view, 8, { target: world } as never),
    )
    const paragraph = editor.view.dom.querySelector('p')!
    editor.view.someProp('handleClick', (click) =>
      click(editor.view, 1, { target: paragraph } as never),
    )

    expect(panel.opened).toEqual(['second'])
  })

  // The editor's scroll area spans 0-500px; the thread's text starts at `top`, each later part a line below
  function placeText(editor: Editor, top: number) {
    const frame = document.createElement('div')
    frame.id = 'editor-scroll-container'
    frame.append(editor.view.dom)
    document.body.append(frame)
    frame.getBoundingClientRect = () => ({ top: 0, bottom: 500 }) as DOMRect
    const parts = [...editor.view.dom.querySelectorAll<HTMLElement>('[data-thread="first"]')]
    for (const [index, part] of parts.entries()) {
      const lineTop = top + index * 20
      part.getBoundingClientRect = () => ({ top: lineTop, bottom: lineTop + 20 }) as DOMRect
      part.scrollIntoView = vi.fn()
    }

    return parts
  }

  it('scrolls to the text only when none of it is in view', () => {
    const { editor } = twoThreads()
    const scrolled: unknown[] = []
    for (const top of [100, -15, -40, 600]) {
      const [text] = placeText(editor, top)
      showThread(editor.view, 'first')
      scrolled.push(vi.mocked(text.scrollIntoView).mock.calls)
    }

    expect(scrolled).toEqual([[], [], [[{ block: 'center' }]], [[{ block: 'center' }]]])
  })

  it('stays put while any part of text split by another thread is in view, else scrolls to its start', () => {
    const doc = new yjs.Doc()
    const threads = { list: [] as DocumentThread[] }
    const editor = openEditor(doc, threads)
    editor.commands.setContent('<p>hello world</p>')
    threads.list = [threadOn(doc, 'second', 0, 8), threadOn(doc, 'first', 4, 11)]
    redrawThreads(editor.view)
    const scrolled: number[][] = []
    for (const top of [-30, -50]) {
      const parts = placeText(editor, top)
      showThread(editor.view, 'first')
      scrolled.push(parts.map((part) => vi.mocked(part.scrollIntoView).mock.calls.length))
    }

    expect(scrolled).toEqual([
      [0, 0],
      [1, 0],
    ])
  })
})
