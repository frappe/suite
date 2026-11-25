import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Heading from '@tiptap/extension-heading'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorContent, Editor as VueEditor } from '@tiptap/vue-3'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import * as yjs from 'yjs'

import { HeadingAnchors } from './heading-anchors'
import { ReceivedContentGuard } from './received-content-guard'
import { TabsExtension } from './tabs'

const editors: Editor[] = []

function destroyEditors() {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
}

afterEach(destroyEditors)
afterEach(() => vi.restoreAllMocks())

function waitForUpdates() {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

function openViewer(state: Uint8Array) {
  const ydoc = new yjs.Doc()
  yjs.applyUpdate(ydoc, state, 'server')
  let writes = 0
  function countWrite(_update: Uint8Array, origin: unknown) {
    if (origin !== 'server' && origin !== 'remote') {
      writes++
    }
  }

  ydoc.on('update', countWrite)

  let anchors: { id: string; textContent: string }[] = []
  const element = document.createElement('div')
  document.body.append(element)
  const collaboration = {
    document: ydoc,
    field: 'default',
  }
  const editorOptions = {
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Heading,
      Collaboration.configure(collaboration),
      HeadingAnchors.configure({
        onUpdate: (items) => {
          anchors = fromPartial(items)
        },
      }),
      ReceivedContentGuard,
    ],
  }
  const editor = new Editor(editorOptions)
  editors.push(editor)
  return {
    ydoc,
    editor,
    writes: () => writes,
    anchors: () => anchors,
  }
}

function legacyDoc(...headings: string[]) {
  const ydoc = new yjs.Doc()
  function headingWithBody(text: string) {
    const heading = new yjs.XmlElement('heading')
    heading.setAttribute('level', fromAny(2))
    heading.insert(0, [new yjs.XmlText(text)])
    const paragraph = new yjs.XmlElement('paragraph')
    paragraph.insert(0, [new yjs.XmlText('body')])
    return [heading, paragraph]
  }

  const blocks = headings.flatMap(headingWithBody)
  ydoc.getXmlFragment('default').insert(0, blocks)
  return yjs.encodeStateAsUpdate(ydoc)
}

function headingIds(editor: Editor) {
  const ids: (string | null)[] = []
  function collect(node: ProseMirrorNode) {
    if (node.type.name === 'heading') {
      ids.push(node.attrs['data-toc-id'])
    }
  }

  editor.state.doc.descendants(collect)

  return ids
}

describe('heading anchors', () => {
  it('opening a document whose headings lack ids writes nothing', async () => {
    const viewer = openViewer(legacyDoc('Intro', 'Intro', 'Usage'))
    await waitForUpdates()

    expect(viewer.writes()).toBe(0)
    expect(headingIds(viewer.editor)).toEqual([null, null, null])
  })

  it('gives those headings working table-of-contents links', async () => {
    const viewer = openViewer(legacyDoc('Intro', 'Intro', 'Usage'))
    await waitForUpdates()

    const anchors = viewer.anchors()
    expect(anchors.map((anchor) => anchor.textContent)).toEqual(['Intro', 'Intro', 'Usage'])
    expect(new Set(anchors.map((anchor) => anchor.id)).size).toBe(3)
    for (const anchor of anchors) {
      const target = viewer.editor.view.dom.querySelector(`[data-toc-id="${anchor.id}"]`)
      expect(target?.textContent).toBe(anchor.textContent)
    }
  })

  it('editing gives the headings ids', async () => {
    const viewer = openViewer(legacyDoc('Intro', 'Usage'))
    await waitForUpdates()

    viewer.editor.commands.insertContentAt(viewer.editor.state.doc.content.size, '<h2>New</h2>')
    const ids = headingIds(viewer.editor)
    expect(ids).toEqual([expect.any(String), expect.any(String), expect.any(String)])
    expect(new Set(ids).size).toBe(3)
    expect(viewer.anchors().map((anchor) => anchor.id)).toEqual(ids)
  })
})

const VIEW_TOP = 100
const VIEW_HEIGHT = 600

// Places each heading so that `tops` are its distances from the top of the visible area
function openScrolledEditor(scroll: { top: number; height: number }) {
  const scroller = document.createElement('div')
  const element = document.createElement('div')
  scroller.append(element)
  document.body.append(scroller)
  scroller.getBoundingClientRect = () =>
    fromPartial({ top: VIEW_TOP, bottom: VIEW_TOP + VIEW_HEIGHT, height: VIEW_HEIGHT })
  Object.defineProperties(scroller, {
    scrollTop: { value: scroll.top },
    clientHeight: { value: VIEW_HEIGHT },
    scrollHeight: { value: scroll.height },
  })

  let anchors: { textContent: string; isActive: boolean }[] = []
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Heading,
      HeadingAnchors.configure({
        scrollParent: () => scroller,
        onUpdate: (items) => {
          anchors = fromPartial(items)
        },
      }),
    ],
    content: ['A', 'B', 'C']
      .map((name) => `<h2 data-toc-id="${name}">${name}</h2><p>body</p>`)
      .join(''),
  })
  editors.push(editor)

  function placeHeadings(tops: Record<string, number>) {
    for (const [id, top] of Object.entries(tops)) {
      const heading = editor.view.dom.querySelector<HTMLElement>(`[data-toc-id="${id}"]`)!
      heading.getClientRects = () => fromPartial([{ top: VIEW_TOP + top }])
      Object.defineProperty(heading, 'offsetTop', { value: scroll.top + top })
    }
    scroller.dispatchEvent(new Event('scroll'))
  }

  function activeHeading() {
    return anchors.find((anchor) => anchor.isActive)?.textContent
  }

  return { placeHeadings, activeHeading }
}

describe('active heading', () => {
  it('is the heading just below the top edge once its section fills the view', async () => {
    const view = openScrolledEditor({ top: 1000, height: 4000 })
    await waitForUpdates()

    view.placeHeadings({ A: -900, B: 30, C: 900 })

    expect(view.activeHeading()).toBe('B')
  })

  it('is the last heading at the bottom, even when it cannot reach the top', async () => {
    const view = openScrolledEditor({ top: 1400, height: 2000 })
    await waitForUpdates()

    view.placeHeadings({ A: -900, B: -300, C: 450 })

    expect(view.activeHeading()).toBe('C')
  })
})

// Two short tabs that fit the view, so changing tab neither scrolls nor edits
function openTabbedEditor() {
  const scroller = document.createElement('div')
  const element = document.createElement('div')
  scroller.append(element)
  document.body.append(scroller)
  scroller.getBoundingClientRect = () =>
    fromPartial({ top: VIEW_TOP, bottom: VIEW_TOP + VIEW_HEIGHT, height: VIEW_HEIGHT })
  Object.defineProperties(scroller, {
    scrollTop: { value: 0, writable: true },
    clientHeight: { value: VIEW_HEIGHT },
    scrollHeight: { value: VIEW_HEIGHT },
  })

  // Each heading sits near the top of the view while its tab shows
  const getClientRects = HTMLElement.prototype.getClientRects
  function headingBoxes(this: HTMLElement) {
    if (this.tagName !== 'H2') return getClientRects.call(this)
    const isHidden = !!this.closest('[style*="display: none"]')
    return fromPartial<DOMRectList>(isHidden ? [] : [{ top: VIEW_TOP + 30 }])
  }
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(headingBoxes)

  let anchors: { textContent: string; isActive: boolean }[] = []
  const editor = new VueEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Heading,
      TabsExtension,
      HeadingAnchors.configure({
        scrollParent: () => scroller,
        onUpdate: (items) => {
          anchors = fromPartial(items)
        },
      }),
    ],
    content:
      '<h2 data-toc-id="A">A</h2><p>body</p>' +
      '<div data-tab-id="tab-c" data-tab-label="C" data-tab-order="0"><h2 data-toc-id="C">C</h2><p>body</p></div>',
  })
  editors.push(editor)
  const app = createApp(() => h(EditorContent, { editor }))
  app.mount(element)

  function activeHeading() {
    return anchors.find((anchor) => anchor.isActive)?.textContent
  }

  return { editor, app, activeHeading }
}

describe('active heading across tabs', () => {
  it('moves to the shown tab when the tab changes, with no scroll or edit', async () => {
    const view = openTabbedEditor()
    await waitForUpdates()
    const before = view.activeHeading()

    view.editor.commands.changeTab('tab-c')
    await waitForUpdates()

    const after = view.activeHeading()
    view.app.unmount()
    history.replaceState(null, '', location.pathname)
    expect([before, after]).toEqual(['A', 'C'])
  })

  it('is in the tab the link opens, with no scroll, edit or tab change', async () => {
    history.replaceState(null, '', '#tab-c')
    const view = openTabbedEditor()
    await waitForUpdates()

    const active = view.activeHeading()
    view.app.unmount()
    history.replaceState(null, '', location.pathname)
    expect(active).toBe('C')
  })
})
