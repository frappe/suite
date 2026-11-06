import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { encodeAnchor } from './anchors'
import { placeThread } from './places'
import type { AnchoredThread } from './restoredAnchors'
import { ThreadsAfterUndo } from './undone-anchors'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function openEditor(doc: Y.Doc, threads: AnchoredThread[] = []) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: doc }),
      // Drive keeps the new anchors, and every tab reads them back
      ThreadsAfterUndo.configure({
        threads: () => threads,
        moved: (anchors) => {
          for (const thread of threads) {
            thread.anchor = anchors[thread.name] ?? thread.anchor
          }
        },
      }),
    ],
  })
  editors.push(editor)
  return editor
}

// The author's tab and a reader's tab on one document, each sending its edits to the other
function twoTabs(content: string) {
  const authorDoc = new Y.Doc()
  const readerDoc = new Y.Doc()
  authorDoc.on('update', (update: Uint8Array) => Y.applyUpdate(readerDoc, update, 'remote'))
  readerDoc.on('update', (update: Uint8Array) => Y.applyUpdate(authorDoc, update, 'remote'))
  const threads: AnchoredThread[] = []
  const author = openEditor(authorDoc, threads)
  const reader = openEditor(readerDoc)
  author.commands.setContent(content)
  yUndoPluginKey.getState(author.state)!.undoManager.stopCapturing()
  return { author, authorDoc, reader, threads }
}

// A thread on characters [start, end) of a paragraph, made the way a tab makes one
function anchorOn(doc: Y.Doc, paragraph: number, start: number, end: number) {
  const text = (doc.getXmlFragment('default').get(paragraph) as Y.XmlElement).get(0) as Y.XmlText
  const from = Y.createRelativePositionFromTypeIndex(text, start, 0)
  const to = Y.createRelativePositionFromTypeIndex(text, end, -1)
  return encodeAnchor(from, to, text.toString().slice(start, end))
}

function shownText(editor: Editor, anchor: string) {
  const place = placeThread(editor.state, anchor)
  return place.kind === 'text' ? editor.state.doc.textBetween(place.from, place.to) : place.kind
}

// The document as a tab opened after a reload reads it
function reloaded(doc: Y.Doc) {
  const fresh = new Y.Doc()
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc))
  return openEditor(fresh)
}

describe('a thread on text that Ctrl+Z brings back', () => {
  it('is on its text again in both tabs, and after a reload', () => {
    const { author, authorDoc, reader, threads } = twoTabs(
      '<p>keep this</p><p>annual billing discount</p>',
    )
    threads.push({ name: 't1', anchor: anchorOn(authorDoc, 1, 15, 23) })

    author.commands.deleteRange({ from: 11, to: 36 })
    const whileDeleted = shownText(reader, threads[0]!.anchor)
    author.commands.undo()
    const anchor = threads[0]!.anchor

    expect(reader.getText()).toBe('keep this\n\nannual billing discount')
    expect([
      whileDeleted,
      shownText(author, anchor),
      shownText(reader, anchor),
      shownText(reloaded(authorDoc), anchor),
    ]).toEqual(['deleted', 'discount', 'discount', 'discount'])
  })

  it('keeps every other thread where it was, and is deleted again by Ctrl+Y', () => {
    const { author, authorDoc, reader, threads } = twoTabs('<p>keep this</p><p>gone soon</p>')
    const kept = anchorOn(authorDoc, 0, 0, 4)
    threads.push(
      { name: 'kept', anchor: kept },
      { name: 'gone', anchor: anchorOn(authorDoc, 1, 5, 9) },
    )

    author.commands.deleteRange({ from: 11, to: 22 })
    author.commands.undo()
    author.commands.redo()

    expect([
      threads[0]!.anchor === kept,
      shownText(reader, threads[0]!.anchor),
      shownText(reader, threads[1]!.anchor),
    ]).toEqual([true, 'keep', 'deleted'])
  })
})
