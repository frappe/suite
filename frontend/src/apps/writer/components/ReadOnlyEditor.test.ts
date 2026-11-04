import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref, type App } from 'vue'
import { Doc, encodeStateAsUpdate, XmlElement, XmlText } from 'yjs'

import type { EditorFile, WriterDocument } from '@/apps/writer/surface/writerDocument'

import ReadOnlyEditor from './ReadOnlyEditor.vue'

vi.mock('./core-editor/menu-buttons', () => ({ buildMenuButtons: () => [] }))
vi.mock('./ToC.vue', () => ({ default: { render: () => null } }))
vi.mock('./ToCMobile.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/drive', () => ({ hasDefaultDocumentTitle: () => false }))
vi.mock('@/apps/writer/composables/useUsers', () => ({
  useUsers: () => ({ users: ref([]) }),
  searchMentions: () => [],
}))
vi.mock('@/stores/root', () => ({ useRootStore: () => ({ paletteOpen: false }) }))

interface Exposed {
  editor: { isEditable: boolean } | undefined
  isUnreadable: boolean
}

const mounted: App[] = []

afterEach(() => {
  for (const app of mounted.splice(0)) {
    app.unmount()
  }

  document.body.replaceChildren()
})

function element(name: string, ...children: (XmlElement | XmlText)[]) {
  const node = new XmlElement(name)
  node.insert(0, children)
  return node
}

function paragraph(text: string) {
  return element('paragraph', new XmlText(text))
}

// The old editor's Yjs store, base64 as the row keeps it
function stored(...blocks: XmlElement[]) {
  const ydoc = new Doc()
  ydoc.getXmlFragment('default').insert(0, blocks)
  return btoa(String.fromCharCode(...encodeStateAsUpdate(ydoc)))
}

function mountOld(
  row: { content: string | null; html: string; collab: number },
  attrs: Record<string, unknown> = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const shown = ref<Exposed | null>(null)
  const props = {
    file: { name: 'node-1', title: 'Plan', isEditable: false } as unknown as EditorFile,
    document: { doc: { ...row, ycomments: null } } as unknown as WriterDocument,
    settings: {},
  }
  const app = createApp({
    setup: () => () => h(ReadOnlyEditor, { ...props, ...attrs, ref: shown }),
  })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  mounted.push(app)
  return { root, shown }
}

function bodyText(root: HTMLElement) {
  return root.querySelector('.ProseMirror')?.textContent ?? null
}

describe('ReadOnlyEditor', () => {
  it('shows the Yjs body an old collaborative document saved, not its stale HTML', async () => {
    const { root, shown } = mountOld({
      content: stored(paragraph('Yjs text')),
      html: '<p>stale</p>',
      collab: 1,
    })

    await vi.waitFor(() => expect(bodyText(root)).toBe('Yjs text'))
    expect(shown.value?.isUnreadable).toBe(false)
    expect(shown.value?.editor?.isEditable).toBe(false)
  })

  it('shows the HTML of a document saved without collaboration', async () => {
    const { root, shown } = mountOld({
      content: stored(paragraph('ignored')),
      html: '<p>Plain body</p>',
      collab: 0,
    })

    await vi.waitFor(() => expect(bodyText(root)).toBe('Plain body'))
    expect(shown.value?.isUnreadable).toBe(false)
    expect(shown.value?.editor?.isEditable).toBe(false)
  })

  it('stays read-only when the page passes editable', async () => {
    const row = { content: stored(paragraph('Yjs text')), html: '<p>stale</p>', collab: 1 }
    const { root, shown } = mountOld(row, { editable: true })

    await vi.waitFor(() => expect(bodyText(root)).toBe('Yjs text'))
    expect(shown.value?.editor?.isEditable).toBe(false)
    expect(root.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('false')
  })

  it('shows the last saved HTML, and says so, when the Yjs bytes do not decode', async () => {
    const { root, shown } = mountOld({ content: btoa('ÿÿÿ'), html: '<p>Saved copy</p>', collab: 1 })

    await vi.waitFor(() => expect(bodyText(root)).toBe('Saved copy'))
    expect(shown.value?.isUnreadable).toBe(true)
  })

  it('shows the last saved HTML, and says so, when the Yjs body holds what the editor cannot place', async () => {
    const cellInBody = element('tableCell', paragraph('cell text'))
    const { root, shown } = mountOld({
      content: stored(paragraph('before'), cellInBody),
      html: '<p>Saved copy</p>',
      collab: 1,
    })

    await vi.waitFor(() => expect(shown.value?.isUnreadable).toBe(true))
    await vi.waitFor(() => expect(bodyText(root)).toBe('Saved copy'))
  })
})
