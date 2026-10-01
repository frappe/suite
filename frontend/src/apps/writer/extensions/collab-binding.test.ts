import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Collaboration from '@tiptap/extension-collaboration'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

const VENDORED = path.resolve(__dirname, '../../../../packages/collab-prosemirror')

// Published @tiptap/y-tiptap 3.0.5, except where a later commit names its change
const SHA256: Record<string, string> = {
  // published 606fedd1...; then every new textblock gets its text node eagerly
  'dist/y-tiptap.js': '56e2d4feca8e7dce32bf86c2c850560a706cb788506bdb07e0d71b3c5766d24b',
  'dist/src/lib.d.ts': '788e88fe93b96cf2852cabfa746d4db525c3bf3b8e620c318627063f29054cd6',
  'dist/src/plugins/cursor-plugin.d.ts': '14df8f3b1fd5b5cdc11bea5eadee07b107719aefd705a97c699465a31488f11a',
  'dist/src/plugins/keys.d.ts': '9596550a6e87582af85039f4c83300bbd6b3e69af1aef98caf2e4d8f632b96f2',
  'dist/src/plugins/sync-plugin.d.ts': '7e5dc45b0517b35834216e6677b167ca8b8a6ad8cccc5cba7368f6182ffd0609',
  'dist/src/plugins/undo-plugin.d.ts': '55375f35812f70dc78b932632264ef10864d39e804197deab1b9d3c7369813e2',
  'dist/src/utils.d.ts': 'c02eb8e03bba34945bf316eaf825c8c31c49e00bea3e5b5b81c8627b47b788f7',
  'dist/src/y-tiptap.d.ts': '456adef97f2428e2efbe0d4a9c18335320aef02f9f58e47b63bc6d12b92ca1d8',
  LICENSE: 'fd69bd7c93b6c32f43c8244c3182029c1af6cc14bb259a0195750f1661e9e304',
}

describe('owned collab binding', () => {
  it('matches the published package plus our recorded changes', () => {
    for (const [file, sha] of Object.entries(SHA256)) {
      const bytes = fs.readFileSync(path.join(VENDORED, file))
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(sha)
    }
  })

  it('is the one copy every importer gets', () => {
    const root = path.resolve(VENDORED, '../../..')
    expect(fs.realpathSync(path.join(root, 'node_modules/@tiptap/y-tiptap'))).toBe(VENDORED)

    const editor = new Editor({
      extensions: [Document, Paragraph, Text, Collaboration.configure({ document: new Y.Doc() })],
    })
    expect(ySyncPluginKey.getState(editor.state)).toBeDefined()
    editor.destroy()
  })
})

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

function open(ydoc: Y.Doc) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, Collaboration.configure({ document: ydoc })],
  })
  editors.push(editor)
  return editor
}

const syncAll = (docs: Y.Doc[]) => {
  for (const to of docs) {
    for (const from of docs) {
      if (from !== to) Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), 'remote')
    }
  }
}

const typeAtEnd = (editor: Editor, text: string) =>
  editor.chain().setTextSelection(editor.state.doc.content.size - 1).insertContent(text).run()

describe('typing at the same time', () => {
  it('two people typing into the same new empty line keep one copy each', () => {
    for (let trial = 0; trial < 40; trial++) {
      const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
      const [a, b, c] = docs
      const [editorA, editorB, editorC] = docs.map(open)
      editorA.commands.setContent('<p>first</p><p></p>')
      syncAll(docs)

      const before = Y.encodeStateVector(a)
      typeAtEnd(editorA, 'TOKA')
      typeAtEnd(editorB, 'TOKB')
      Y.applyUpdate(c, Y.encodeStateAsUpdate(a, before), 'remote')
      Y.applyUpdate(c, Y.encodeStateAsUpdate(b, before), 'remote')
      typeAtEnd(editorC, 'TOKC')
      syncAll(docs)
      syncAll(docs)

      for (const editor of [editorA, editorB, editorC]) {
        const text = editor.state.doc.textContent
        for (const token of ['TOKA', 'TOKB', 'TOKC']) {
          expect(text.split(token).length - 1, `trial ${trial}: ${text}`).toBe(1)
        }
      }
      editors.splice(0).forEach((editor) => editor.destroy())
    }
  })
})
