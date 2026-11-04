import { Editor, getSchema, type EditorOptions, type JSONContent } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { prosemirrorJSONToYDoc, ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { writerEditorExtensions, type WriterEditorOptions } from '../editor-extensions'
import { writerSchema } from '../schema'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

interface Size {
  width: number
  height: number
}

const measure = vi.fn(async (_src: string): Promise<Size> => ({ width: 100, height: 50 }))

class MeasuredImage {
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  set src(src: string) {
    void this.load(src)
  }

  async load(src: string) {
    let size: Size
    try {
      size = await measure(src)
    } catch (error) {
      this.onerror?.(error)
      return
    }

    this.naturalWidth = size.width
    this.naturalHeight = size.height
    this.onload?.()
  }
}

beforeEach(() => vi.stubGlobal('Image', MeasuredImage))
const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }

  measure.mockClear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function waitForUpdates() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function image(src: string, attrs: object = {}) {
  return {
    type: 'image',
    attrs: { src, ...attrs },
  }
}

function imageParagraph(src: string, attrs: object = {}) {
  return {
    type: 'paragraph',
    content: [image(src, attrs)],
  }
}

function paragraph(text: string) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  }
}

function doc(...content: object[]): JSONContent {
  return {
    type: 'doc',
    content,
  }
}

function editorExtensions(ydoc: yjs.Doc | null) {
  const options: WriterEditorOptions = {
    isCollaborative: !!ydoc,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => window,
    media: null,
  }
  const baseExtensions = writerEditorExtensions(options)
  if (!ydoc) {
    return baseExtensions
  }

  const collaboration = {
    document: ydoc,
    field: 'default',
  }
  return [...baseExtensions, Collaboration.configure(collaboration)]
}

function openEditor(content: JSONContent | yjs.Doc, isCollaborative = true) {
  let ydoc: yjs.Doc | null = null
  if (content instanceof yjs.Doc) {
    ydoc = content
  } else if (isCollaborative) {
    const schema = getSchema(writerSchema())
    ydoc = prosemirrorJSONToYDoc(schema, content, 'default')
  }

  let writes = 0
  function countWrite(_update: Uint8Array, origin: unknown) {
    if (origin !== 'remote') {
      writes++
    }
  }

  ydoc?.on('update', countWrite)

  const editorOptions: Partial<EditorOptions> = { extensions: editorExtensions(ydoc) }
  if (!ydoc) {
    editorOptions.content = content as JSONContent
  }

  const editor = new Editor(editorOptions)
  editors.push(editor)
  return {
    editor,
    ydoc,
    writes: () => writes,
  }
}

function typeAtEnd(editor: Editor, text = 'y') {
  return editor.commands.insertContentAt(editor.state.doc.content.size - 1, text)
}

function mediaSizes(editor: Editor, name = 'image') {
  const sizes: [unknown, unknown][] = []
  function collectSize(node: ProseMirrorNode) {
    if (node.type.name === name) {
      sizes.push([node.attrs.width, node.attrs.height])
    }
  }

  editor.state.doc.descendants(collectSize)

  return sizes
}

describe.each([
  ['a plain', false],
  ['a collaborative', true],
])('media sizes in %s document', (_, isCollaborative) => {
  const stored = doc(imageParagraph('/files/old.png'), paragraph('x'))

  it('writes nothing when the document opens', async () => {
    const { editor, writes } = openEditor(stored, isCollaborative)
    const updated = vi.fn()
    editor.on('update', updated)
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([[null, null]])
    expect(updated).not.toHaveBeenCalled()
    expect(writes()).toBe(0)
  })

  it('sizes stored media right after the first edit the person makes', async () => {
    const { editor } = openEditor(stored, isCollaborative)
    await waitForUpdates()
    typeAtEnd(editor)
    await Promise.resolve()

    expect(editor.state.doc.textContent).toBe('xy')
    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('sends the sizes after the edit, kept out of history', async () => {
    const { editor } = openEditor(stored, isCollaborative)
    await waitForUpdates()
    const sent: Transaction[] = []
    function recordChange({ transaction }: { transaction: Transaction }) {
      if (transaction.docChanged) {
        sent.push(transaction)
      }
    }

    editor.on('transaction', recordChange)
    typeAtEnd(editor)
    await Promise.resolve()

    expect(sent).toHaveLength(2)
    expect(sent[0].getMeta('heal')).toBeUndefined()
    expect(sent[1].getMeta('heal')).toBe(true)
    expect(sent[1].getMeta('addToHistory')).toBe(false)
  })

  it("undoes the person's edit, not the sizing", async () => {
    const { editor } = openEditor(stored, isCollaborative)
    await waitForUpdates()
    typeAtEnd(editor)
    await waitForUpdates()
    editor.commands.undo()
    await waitForUpdates()

    expect(editor.state.doc.textContent).toBe('x')
    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('does not size an image that undo brings back', async () => {
    const { editor } = openEditor(stored, isCollaborative)
    await waitForUpdates()
    editor.commands.deleteRange({ from: 1, to: 2 })
    await waitForUpdates()
    editor.commands.undo()
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([[null, null]])
  })
})

describe('media sizes', () => {
  it('leaves media alone when a collaborator changes the document', async () => {
    const { editor } = openEditor(doc(imageParagraph('/files/old.png'), paragraph('x')))
    await waitForUpdates()
    const theirImage = editor.schema.nodes.image.create({ src: '/files/theirs.png' })
    const received = editor.state.tr
      .insert(1, theirImage)
      .setMeta(ySyncPluginKey, { isChangeOrigin: true })
    editor.view.dispatch(received)
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([
      [null, null],
      [null, null],
    ])
  })

  it("sizes only what the person's edit owed, not a collaborator's later image", async () => {
    const { promise: measuring, resolve: finishMeasuring } = Promise.withResolvers<Size>()
    measure.mockImplementationOnce(() => measuring)
    const { editor } = openEditor(doc(imageParagraph('/files/old.png'), paragraph('x')))
    typeAtEnd(editor)
    const theirImage = editor.schema.nodes.image.create({ src: '/files/theirs.png' })
    const received = editor.state.tr
      .insert(1, theirImage)
      .setMeta(ySyncPluginKey, { isChangeOrigin: true })
    editor.view.dispatch(received)
    await waitForUpdates()

    finishMeasuring({ width: 100, height: 50 })
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([
      [null, null],
      [100, 50],
    ])
  })

  it('does not give an image the size of the file it replaced', async () => {
    measure.mockImplementationOnce(async () => ({ width: 7, height: 7 }))
    const { editor } = openEditor(doc(imageParagraph('/files/old.png'), paragraph('x')))
    const replaced = editor.state.tr
      .setNodeAttribute(1, 'src', '/files/new.png')
      .setMeta(ySyncPluginKey, { isChangeOrigin: true })
    editor.view.dispatch(replaced)
    await waitForUpdates()
    typeAtEnd(editor)
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('sizes stored media after an edit that came before it was measured', async () => {
    const { promise: measuring, resolve: finishMeasuring } = Promise.withResolvers<Size>()
    measure.mockImplementationOnce(() => measuring)
    const { editor } = openEditor(doc(imageParagraph('/files/old.png'), paragraph('x')))
    typeAtEnd(editor)
    await waitForUpdates()
    expect(mediaSizes(editor)).toEqual([[null, null]])

    finishMeasuring({ width: 100, height: 50 })
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('sizes an image the person inserts', async () => {
    const { editor } = openEditor(doc(paragraph('x')))
    editor.commands.insertContentAt(0, image('/files/new.png'))
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('sizes stored media when its attributes change', async () => {
    const { editor } = openEditor(doc(imageParagraph('/files/old.png'), paragraph('x')))
    await waitForUpdates()
    editor.view.dispatch(editor.state.tr.setNodeAttribute(1, 'align', 'left'))
    await Promise.resolve()

    expect(editor.state.doc.nodeAt(1)!.attrs.align).toBe('left')
    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('fills only the side that is missing', async () => {
    const { editor } = openEditor(
      doc(imageParagraph('/files/old.png', { width: 300 }), paragraph('x')),
    )
    await waitForUpdates()
    typeAtEnd(editor)
    await Promise.resolve()

    expect(mediaSizes(editor)).toEqual([[300, 50]])
  })

  it('measures a source once for every image that uses it', async () => {
    const { editor } = openEditor(
      doc(imageParagraph('/files/a.png'), imageParagraph('/files/a.png'), paragraph('x')),
    )
    await waitForUpdates()
    typeAtEnd(editor)
    await Promise.resolve()

    expect(measure).toHaveBeenCalledTimes(1)
    expect(mediaSizes(editor)).toEqual([
      [100, 50],
      [100, 50],
    ])
  })

  it('measures a source once when a menu registers a plugin', async () => {
    const { editor } = openEditor(doc(imageParagraph('/files/a.png'), paragraph('x')))
    await waitForUpdates()
    editor.registerPlugin(new Plugin({ key: new PluginKey('menu') }))
    await waitForUpdates()
    typeAtEnd(editor)
    await waitForUpdates()

    expect(measure).toHaveBeenCalledTimes(1)
    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('leaves loaded content as it came until the person edits', async () => {
    const { editor } = openEditor(doc(paragraph('x')), false)
    editor.commands.setContent(doc(imageParagraph('/files/loaded.png'), paragraph('x')), {
      emitUpdate: false,
    })
    await waitForUpdates()
    expect(mediaSizes(editor)).toEqual([[null, null]])

    typeAtEnd(editor)
    await Promise.resolve()
    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('sizes content set with an update event', async () => {
    const { editor } = openEditor(doc(paragraph('x')), false)
    editor.commands.setContent(doc(imageParagraph('/files/set.png'), paragraph('x')), {
      emitUpdate: true,
    })
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('sizes an image once its upload finishes', async () => {
    const { editor } = openEditor(doc(paragraph('x')))
    editor.commands.insertContentAt(0, image('blob:pending', { loading: true }))
    await waitForUpdates()
    expect(measure).not.toHaveBeenCalled()

    const uploaded = editor.state.tr
      .setNodeAttribute(1, 'src', '/files/done.png')
      .setNodeAttribute(1, 'loading', false)
    editor.view.dispatch(uploaded)
    await waitForUpdates()

    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('measures again on the next change when a file could not be measured', async () => {
    measure.mockRejectedValueOnce(new Error('offline'))
    const { editor } = openEditor(doc(imageParagraph('/files/old.png'), paragraph('x')))
    await waitForUpdates()
    expect(mediaSizes(editor)).toEqual([[null, null]])

    typeAtEnd(editor)
    await waitForUpdates()

    expect(measure).toHaveBeenCalledTimes(2)
    expect(mediaSizes(editor)).toEqual([[100, 50]])
  })

  it('sizes a stored video right after the first edit', async () => {
    const dimensions = {
      videoWidth: { value: 640 },
      videoHeight: { value: 360 },
    }
    function loadMetadata(this: HTMLVideoElement) {
      Object.defineProperties(this, dimensions)
      queueMicrotask(() => this.onloadedmetadata?.(new Event('loadedmetadata')))
    }

    vi.spyOn(HTMLVideoElement.prototype, 'src', 'set').mockImplementation(loadMetadata)
    const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const video = {
      type: 'video',
      attrs: { src: '/files/clip.mp4' },
    }
    const { editor } = openEditor(doc(video, paragraph('x')))
    await waitForUpdates()
    expect(mediaSizes(editor, 'video')).toEqual([[null, null]])
    expect(loadSpy).toHaveBeenCalledTimes(1)

    typeAtEnd(editor)
    await waitForUpdates()

    expect(mediaSizes(editor, 'video')).toEqual([[640, 360]])
  })
})

it('does not size an image that undo brings back with a fix-up', async () => {
  function heading(text: string) {
    return {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text }],
    }
  }

  const { editor } = openEditor(doc(imageParagraph('/files/old.png'), heading('End')), false)
  await waitForUpdates()
  editor.commands.deleteRange({ from: 1, to: 2 })
  await waitForUpdates()
  expect(editor.state.doc.lastChild!.type.name).toBe('paragraph')

  editor.commands.undo()
  await waitForUpdates()

  expect(editor.state.doc.lastChild!.type.name).toBe('paragraph')
  expect(mediaSizes(editor)).toEqual([[null, null]])
})

describe('media sizes with collaborators', () => {
  function pair(content: JSONContent) {
    const schema = getSchema(writerSchema())
    const source = prosemirrorJSONToYDoc(schema, content, 'default')
    const stored = yjs.encodeStateAsUpdate(source)
    const [docA, docB] = [new yjs.Doc(), new yjs.Doc()]
    yjs.applyUpdate(docA, stored, 'remote')
    yjs.applyUpdate(docB, stored, 'remote')

    function relayTo(target: yjs.Doc) {
      return function relay(update: Uint8Array, origin: unknown) {
        if (origin !== 'remote') {
          yjs.applyUpdate(target, update, 'remote')
        }
      }
    }

    docA.on('update', relayTo(docB))
    docB.on('update', relayTo(docA))
    return [openEditor(docA), openEditor(docB)]
  }

  it('sends the edit and then the sizes, and both clients undo only the edit', async () => {
    const [mine, theirs] = pair(doc(imageParagraph('/files/old.png'), paragraph('x')))
    await waitForUpdates()
    expect(mine.writes()).toBe(0)

    typeAtEnd(mine.editor)
    await waitForUpdates()
    expect(mine.writes()).toBe(2)
    expect(theirs.writes()).toBe(0)
    expect(theirs.editor.state.doc.textContent).toBe('xy')
    expect(mediaSizes(theirs.editor)).toEqual([[100, 50]])

    mine.editor.commands.undo()
    await waitForUpdates()
    for (const { editor } of [mine, theirs]) {
      expect(editor.state.doc.textContent).toBe('x')
      expect(mediaSizes(editor)).toEqual([[100, 50]])
    }

    mine.editor.commands.redo()
    await waitForUpdates()
    expect(theirs.editor.state.doc.textContent).toBe('xy')
  })
})
