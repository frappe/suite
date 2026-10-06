import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { prosemirrorJSONToYDoc, ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import { writerEditorExtensions } from '../editor-extensions'
import { writerSchema } from '../schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

type Size = { width: number; height: number }
const measure = vi.fn(async (_src: string): Promise<Size> => ({ width: 100, height: 50 }))

class MeasuredImage {
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  set src(src: string) {
    measure(src).then(
      ({ width, height }) => {
        this.naturalWidth = width
        this.naturalHeight = height
        this.onload?.()
      },
      (error) => this.onerror?.(error),
    )
  }
}

beforeEach(() => vi.stubGlobal('Image', MeasuredImage))
const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  measure.mockClear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const image = (src: string, attrs: object = {}) => ({ type: 'image', attrs: { src, ...attrs } })
const pic = (src: string, attrs: object = {}) => ({
  type: 'paragraph',
  content: [image(src, attrs)],
})
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content: object[]): JSONContent => ({ type: 'doc', content })

function extensions(ydoc: Y.Doc | null) {
  const comments = new Y.Doc()
  return [
    ...writerEditorExtensions({
      collaborative: !!ydoc,
      mentionItems: () => [],
      onMentionQuery: () => {},
      onCommentActivated: () => {},
      onAnchors: () => {},
      scrollParent: () => window,
      media: null,
      comments: comments.getMap('comments'),
      ydoc: comments,
      activeComment: ref(null),
      showComments: ref(false),
      showResolved: ref(false),
      edited: ref(false),
      onCommentsPainted: () => {},
    }),
    ...(ydoc ? [Collaboration.configure({ document: ydoc, field: 'default' })] : []),
  ]
}

function open(content: JSONContent | Y.Doc, collaborative = true) {
  let ydoc: Y.Doc | null = null
  if (content instanceof Y.Doc) ydoc = content
  else if (collaborative)
    ydoc = prosemirrorJSONToYDoc(getSchema(writerSchema()), content, 'default')
  let writes = 0
  ydoc?.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') writes++
  })
  const editor = new Editor({
    extensions: extensions(ydoc),
    ...(!ydoc && { content: content as JSONContent }),
  })
  editors.push(editor)
  return { editor, ydoc, writes: () => writes }
}

const type = (editor: Editor, text = 'y') =>
  editor.commands.insertContentAt(editor.state.doc.content.size - 1, text)

const sizes = (editor: Editor, name = 'image') => {
  const found: [unknown, unknown][] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === name) found.push([node.attrs.width, node.attrs.height])
  })
  return found
}

describe.each([
  ['a plain', false],
  ['a collaborative', true],
])('media sizes in %s document', (_, collaborative) => {
  const stored = doc(pic('/files/old.png'), p('x'))

  it('writes nothing when the document opens', async () => {
    const { editor, writes } = open(stored, collaborative)
    const updated = vi.fn()
    editor.on('update', updated)
    await settle()

    expect(sizes(editor)).toEqual([[null, null]])
    expect(updated).not.toHaveBeenCalled()
    expect(writes()).toBe(0)
  })

  it('sizes stored media right after the first edit the person makes', async () => {
    const { editor } = open(stored, collaborative)
    await settle()
    type(editor)
    await Promise.resolve()

    expect(editor.state.doc.textContent).toBe('xy')
    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('sends the sizes after the edit, kept out of history', async () => {
    const { editor } = open(stored, collaborative)
    await settle()
    const sent: Transaction[] = []
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) sent.push(transaction)
    })
    type(editor)
    await Promise.resolve()

    expect(sent).toHaveLength(2)
    expect(sent[0].getMeta('heal')).toBeUndefined()
    expect(sent[1].getMeta('heal')).toBe(true)
    expect(sent[1].getMeta('addToHistory')).toBe(false)
  })

  it("undoes the person's edit, not the sizing", async () => {
    const { editor } = open(stored, collaborative)
    await settle()
    type(editor)
    await settle()
    editor.commands.undo()
    await settle()

    expect(editor.state.doc.textContent).toBe('x')
    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('does not size an image that undo brings back', async () => {
    const { editor } = open(stored, collaborative)
    await settle()
    editor.commands.deleteRange({ from: 1, to: 2 })
    await settle()
    editor.commands.undo()
    await settle()

    expect(sizes(editor)).toEqual([[null, null]])
  })
})

describe('media sizes', () => {
  it('leaves media alone when a collaborator changes the document', async () => {
    const { editor } = open(doc(pic('/files/old.png'), p('x')))
    await settle()
    editor.view.dispatch(
      editor.state.tr
        .insert(1, editor.schema.nodes.image.create({ src: '/files/theirs.png' }))
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    )
    await settle()

    expect(sizes(editor)).toEqual([
      [null, null],
      [null, null],
    ])
  })

  it("sizes only what the person's edit owed, not a collaborator's later image", async () => {
    let measured = (_size: Size) => {}
    measure.mockImplementationOnce(() => new Promise((resolve) => (measured = resolve)))
    const { editor } = open(doc(pic('/files/old.png'), p('x')))
    type(editor)
    editor.view.dispatch(
      editor.state.tr
        .insert(1, editor.schema.nodes.image.create({ src: '/files/theirs.png' }))
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    )
    await settle()

    measured({ width: 100, height: 50 })
    await settle()

    expect(sizes(editor)).toEqual([
      [null, null],
      [100, 50],
    ])
  })

  it('does not give an image the size of the file it replaced', async () => {
    measure.mockImplementationOnce(async () => ({ width: 7, height: 7 }))
    const { editor } = open(doc(pic('/files/old.png'), p('x')))
    editor.view.dispatch(
      editor.state.tr
        .setNodeAttribute(1, 'src', '/files/new.png')
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    )
    await settle()
    type(editor)
    await settle()

    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('sizes stored media after an edit that came before it was measured', async () => {
    let measured = (_size: Size) => {}
    measure.mockImplementationOnce(() => new Promise((resolve) => (measured = resolve)))
    const { editor } = open(doc(pic('/files/old.png'), p('x')))
    type(editor)
    await settle()
    expect(sizes(editor)).toEqual([[null, null]])

    measured({ width: 100, height: 50 })
    await settle()

    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('sizes an image the person inserts', async () => {
    const { editor } = open(doc(p('x')))
    editor.commands.insertContentAt(0, image('/files/new.png'))
    await settle()

    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('sizes stored media when its attributes change', async () => {
    const { editor } = open(doc(pic('/files/old.png'), p('x')))
    await settle()
    editor.view.dispatch(editor.state.tr.setNodeAttribute(1, 'align', 'left'))
    await Promise.resolve()

    expect(editor.state.doc.nodeAt(1)!.attrs.align).toBe('left')
    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('fills only the side that is missing', async () => {
    const { editor } = open(doc(pic('/files/old.png', { width: 300 }), p('x')))
    await settle()
    type(editor)
    await Promise.resolve()

    expect(sizes(editor)).toEqual([[300, 50]])
  })

  it('measures a source once for every image that uses it', async () => {
    const { editor } = open(doc(pic('/files/a.png'), pic('/files/a.png'), p('x')))
    await settle()
    type(editor)
    await Promise.resolve()

    expect(measure).toHaveBeenCalledTimes(1)
    expect(sizes(editor)).toEqual([
      [100, 50],
      [100, 50],
    ])
  })

  it('measures a source once when a menu registers a plugin', async () => {
    const { editor } = open(doc(pic('/files/a.png'), p('x')))
    await settle()
    editor.registerPlugin(new Plugin({ key: new PluginKey('menu') }))
    await settle()
    type(editor)
    await settle()

    expect(measure).toHaveBeenCalledTimes(1)
    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('leaves loaded content as it came until the person edits', async () => {
    const { editor } = open(doc(p('x')), false)
    editor.commands.setContent(doc(pic('/files/loaded.png'), p('x')), { emitUpdate: false })
    await settle()
    expect(sizes(editor)).toEqual([[null, null]])

    type(editor)
    await Promise.resolve()
    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('sizes content set with an update event', async () => {
    const { editor } = open(doc(p('x')), false)
    editor.commands.setContent(doc(pic('/files/set.png'), p('x')), { emitUpdate: true })
    await settle()

    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('sizes an image once its upload finishes', async () => {
    const { editor } = open(doc(p('x')))
    editor.commands.insertContentAt(0, image('blob:pending', { loading: true }))
    await settle()
    expect(measure).not.toHaveBeenCalled()

    editor.view.dispatch(
      editor.state.tr
        .setNodeAttribute(1, 'src', '/files/done.png')
        .setNodeAttribute(1, 'loading', false),
    )
    await settle()

    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('measures again on the next change when a file could not be measured', async () => {
    measure.mockRejectedValueOnce(new Error('offline'))
    const { editor } = open(doc(pic('/files/old.png'), p('x')))
    await settle()
    expect(sizes(editor)).toEqual([[null, null]])

    type(editor)
    await settle()

    expect(measure).toHaveBeenCalledTimes(2)
    expect(sizes(editor)).toEqual([[100, 50]])
  })

  it('sizes a stored video right after the first edit', async () => {
    vi.spyOn(HTMLVideoElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLVideoElement,
    ) {
      Object.defineProperties(this, { videoWidth: { value: 640 }, videoHeight: { value: 360 } })
      queueMicrotask(() => this.onloadedmetadata?.(new Event('loadedmetadata')))
    })
    const stop = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const { editor } = open(doc({ type: 'video', attrs: { src: '/files/clip.mp4' } }, p('x')))
    await settle()
    expect(sizes(editor, 'video')).toEqual([[null, null]])
    expect(stop).toHaveBeenCalledTimes(1)

    type(editor)
    await settle()

    expect(sizes(editor, 'video')).toEqual([[640, 360]])
  })
})

it('does not size an image that undo brings back with a fix-up', async () => {
  const h = (text: string) => ({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text }],
  })
  const { editor } = open(doc(pic('/files/old.png'), h('End')), false)
  await settle()
  editor.commands.deleteRange({ from: 1, to: 2 })
  await settle()
  expect(editor.state.doc.lastChild!.type.name).toBe('paragraph')

  editor.commands.undo()
  await settle()

  expect(editor.state.doc.lastChild!.type.name).toBe('paragraph')
  expect(sizes(editor)).toEqual([[null, null]])
})

describe('media sizes with collaborators', () => {
  function pair(content: JSONContent) {
    const stored = Y.encodeStateAsUpdate(
      prosemirrorJSONToYDoc(getSchema(writerSchema()), content, 'default'),
    )
    const [a, b] = [new Y.Doc(), new Y.Doc()]
    Y.applyUpdate(a, stored, 'remote')
    Y.applyUpdate(b, stored, 'remote')
    a.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') Y.applyUpdate(b, update, 'remote')
    })
    b.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') Y.applyUpdate(a, update, 'remote')
    })
    return [open(a), open(b)]
  }

  it('sends the edit and then the sizes, and both clients undo only the edit', async () => {
    const [mine, theirs] = pair(doc(pic('/files/old.png'), p('x')))
    await settle()
    expect(mine.writes()).toBe(0)

    type(mine.editor)
    await settle()
    expect(mine.writes()).toBe(2)
    expect(theirs.writes()).toBe(0)
    expect(theirs.editor.state.doc.textContent).toBe('xy')
    expect(sizes(theirs.editor)).toEqual([[100, 50]])

    mine.editor.commands.undo()
    await settle()
    for (const { editor } of [mine, theirs]) {
      expect(editor.state.doc.textContent).toBe('x')
      expect(sizes(editor)).toEqual([[100, 50]])
    }

    mine.editor.commands.redo()
    await settle()
    expect(theirs.editor.state.doc.textContent).toBe('xy')
  })
})
