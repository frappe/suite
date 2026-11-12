import { Editor, type AnyExtension } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import type { Transaction } from '@tiptap/pm/state'
import { ySyncPlugin, ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { RoomPresence } from '@/platform/collab'

import { liveTextExtensions } from './liveText'
import { isReceivedChange } from './receivedChange'

function boundEditor(fragment: Y.XmlFragment, seen: Transaction[]) {
  const sync: AnyExtension = Document.extend({
    addProseMirrorPlugins: () => [ySyncPlugin(fragment)],
  })
  return new Editor({
    extensions: [sync, Paragraph, Text],
    onTransaction: ({ transaction }) => seen.push(transaction),
  })
}

let editor: Editor | undefined

afterEach(() => editor?.destroy())

function typeIn(fragment: Y.XmlFragment, text: string) {
  const paragraph = new Y.XmlElement('paragraph')
  paragraph.insert(0, [new Y.XmlText(text)])
  fragment.insert(0, [paragraph])
}

function editorWithUndo(doc: Y.Doc, seen: Transaction[] = []) {
  const fragment = doc.getXmlFragment('text')
  const undoManager = new Y.UndoManager(fragment, {
    trackedOrigins: new Set([ySyncPluginKey]),
    captureTimeout: 500,
  })
  const presence: RoomPresence = {
    awareness: new Awareness(doc),
    peers: [],
    ownPid: 1,
    ownArrival: null,
    onChange: () => () => {},
  }
  const opened = new Editor({
    extensions: [Document, Paragraph, Text, ...liveTextExtensions(fragment, presence, undoManager)],
    onTransaction: ({ transaction }) => seen.push(transaction),
  })
  editor = opened
  return { undoManager, editor: opened }
}

describe('undo in a live text editor', () => {
  it('takes a new line back on its own', () => {
    const { undoManager, editor } = editorWithUndo(new Y.Doc())

    editor.commands.insertContent('first')
    editor.commands.splitBlock()
    editor.commands.insertContent('second')
    undoManager.undo()

    expect(editor.getText()).toBe('first')
  })

  it('survives closing the editor, for the next one on the same stack', () => {
    const { undoManager, editor } = editorWithUndo(new Y.Doc())

    editor.commands.insertContent('kept')
    editor.destroy()
    undoManager.undo()

    expect(undoManager.redoStack).toHaveLength(1)
  })

  it('counts this tab undoing its typing as received, so no write empties the redo', () => {
    const seen: Transaction[] = []
    const { undoManager, editor } = editorWithUndo(new Y.Doc(), seen)
    editor.commands.insertContent('mine')
    seen.length = 0

    undoManager.undo()

    const changes = seen.filter((transaction) => transaction.docChanged)
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.every(isReceivedChange)).toBe(true)
  })
})

describe('isReceivedChange', () => {
  it('is true for a change that arrived through the live document', () => {
    const doc = new Y.Doc()
    const fragment = doc.getXmlFragment('text')
    const seen: Transaction[] = []
    editor = boundEditor(fragment, seen)
    seen.length = 0

    typeIn(fragment, 'from a co-editor')

    expect(editor.getText()).toContain('from a co-editor')
    expect(seen.filter((transaction) => transaction.docChanged).every(isReceivedChange)).toBe(true)
  })

  it('is false for what this tab types', () => {
    const fragment = new Y.Doc().getXmlFragment('text')
    const seen: Transaction[] = []
    editor = boundEditor(fragment, seen)
    seen.length = 0

    editor.commands.insertContent('mine')

    const changes = seen.filter((transaction) => transaction.docChanged)
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.some(isReceivedChange)).toBe(false)
  })
})
