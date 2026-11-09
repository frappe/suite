import { Editor, type AnyExtension } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import type { Transaction } from '@tiptap/pm/state'
import { ySyncPlugin } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { isRemoteChange } from './liveText'

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

describe('isRemoteChange', () => {
  it('is true for a change that arrived through the live document', () => {
    const doc = new Y.Doc()
    const fragment = doc.getXmlFragment('text')
    const seen: Transaction[] = []
    editor = boundEditor(fragment, seen)
    seen.length = 0

    typeIn(fragment, 'from a co-editor')

    expect(editor.getText()).toContain('from a co-editor')
    expect(seen.filter((transaction) => transaction.docChanged).every(isRemoteChange)).toBe(true)
  })

  it('is false for what this tab types', () => {
    const fragment = new Y.Doc().getXmlFragment('text')
    const seen: Transaction[] = []
    editor = boundEditor(fragment, seen)
    seen.length = 0

    editor.commands.insertContent('mine')

    const changes = seen.filter((transaction) => transaction.docChanged)
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.some(isRemoteChange)).toBe(false)
  })
})
