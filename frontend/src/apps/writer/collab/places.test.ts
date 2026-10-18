import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { anchorEnds, DOCUMENT_ANCHOR, encodeAnchor } from './anchors'
import { anchorSelection, placeThread } from './places'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function openEditor(doc = new Y.Doc()) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [Document, Paragraph, Text, Collaboration.configure({ document: doc })],
  })
  editors.push(editor)
  return editor
}

function paragraphText(doc: Y.Doc, index = 0) {
  return (doc.getXmlFragment('default').get(index) as Y.XmlElement).get(0) as Y.XmlText
}

// A thread on characters [start, end) of a paragraph, made the way a tab makes one
function anchorOn(text: Y.XmlText, start: number, end: number) {
  const from = Y.createRelativePositionFromTypeIndex(text, start, 0)
  const to = Y.createRelativePositionFromTypeIndex(text, end, -1)
  return encodeAnchor(from, to, text.toString().slice(start, end))
}

function shownText(editor: Editor, anchor: string) {
  const place = placeThread(editor.state, anchor)
  if (place.kind !== 'text') {
    return place.kind
  }

  return editor.state.doc.textBetween(place.from, place.to)
}

describe('where a thread shows', () => {
  it('follows its words while text is typed before them and at both edges', () => {
    const doc = new Y.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p>')
    const anchor = anchorOn(paragraphText(doc), 6, 11)

    editor.commands.insertContentAt(1, 'well, ')
    editor.commands.insertContentAt(13, '[')
    editor.commands.insertContentAt(19, ']')

    expect([editor.getText(), shownText(editor, anchor)]).toEqual(['well, hello [world]', 'world'])
  })

  it('keeps what is left when its first or last character is deleted', () => {
    const doc = new Y.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p>')
    const anchor = anchorOn(paragraphText(doc), 6, 11)

    editor.commands.deleteRange({ from: 7, to: 8 })
    editor.commands.deleteRange({ from: 10, to: 11 })

    expect(shownText(editor, anchor)).toBe('orl')
  })

  it('is deleted, with its quote, once all its words are gone or their paragraph is', () => {
    const doc = new Y.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p><p>second line</p>')
    const onWorld = anchorOn(paragraphText(doc), 6, 11)
    const onSecond = anchorOn(paragraphText(doc, 1), 0, 6)

    editor.commands.deleteRange({ from: 7, to: 12 })
    editor.commands.deleteRange({ from: 8, to: 21 })

    expect(editor.getText()).toBe('hello ')
    expect(placeThread(editor.state, onWorld)).toEqual({ kind: 'deleted', quote: 'world' })
    expect(placeThread(editor.state, onSecond)).toEqual({ kind: 'deleted', quote: 'second' })
  })

  it("waits for another tab's text before showing a thread on it", () => {
    const local = new Y.Doc()
    const editor = openEditor(local)
    editor.commands.setContent('<p>hello</p>')
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local))
    const before = Y.encodeStateVector(remote)
    paragraphText(remote).insert(5, ' there')
    const anchor = anchorOn(paragraphText(remote), 6, 11)

    const waiting = placeThread(editor.state, anchor)
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, before))

    expect(waiting).toEqual({ kind: 'arriving', quote: 'there' })
    expect(shownText(editor, anchor)).toBe('there')
  })

  it('shows a document thread on the document and an old comment id as not attached', () => {
    const editor = openEditor()

    expect(placeThread(editor.state, DOCUMENT_ANCHOR)).toEqual({ kind: 'document' })
    expect(placeThread(editor.state, '5f0c2e6a-old-comment')).toEqual({ kind: 'unplaced' })
  })
})

describe('an anchor on the selection', () => {
  it('holds its first and last characters, so text typed at either edge stays outside', () => {
    const doc = new Y.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p><p>second line</p>')
    editor.commands.setTextSelection({ from: 7, to: 20 })
    const anchor = anchorSelection(editor.state)!

    editor.commands.insertContentAt(20, '!')
    editor.commands.insertContentAt(7, '[')

    expect([placeThread(editor.state, anchor), editor.getText({ blockSeparator: '|' })]).toEqual([
      { kind: 'text', from: 8, to: 21, quote: 'world second' },
      'hello [world|second! line',
    ])
  })

  it('names the characters at its ends for the saved check', () => {
    const doc = new Y.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p>')
    editor.commands.setTextSelection({ from: 7, to: 12 })
    const text = paragraphText(doc)
    const [first, last] = [6, 10].map((index) => {
      const item = Y.createRelativePositionFromTypeIndex(text, index, 0).item!
      return [item.client, item.clock]
    })

    const ends = anchorEnds(anchorSelection(editor.state)!).map((id) => [id.client, id.clock])

    expect(ends).toEqual([first, last])
  })

  it('is none for an empty selection, and a document anchor has no ends', () => {
    const editor = openEditor()
    editor.commands.setContent('<p>hello</p>')
    editor.commands.setTextSelection(3)

    expect([anchorSelection(editor.state), anchorEnds(DOCUMENT_ANCHOR)]).toEqual([null, []])
  })
})
