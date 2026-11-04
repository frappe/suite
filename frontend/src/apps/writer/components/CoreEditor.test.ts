import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'

import CoreEditor from './CoreEditor.vue'

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  const passthrough = define({
    setup:
      (_, { slots }) =>
      () =>
        render('div', slots.default?.()),
  })
  return {
    Button: passthrough,
    Dropdown: passthrough,
    toast: { info: () => {}, success: () => {}, warning: () => {}, error: () => {} },
    useFileUpload: () => ({ upload: async () => ({}) }),
  }
})
vi.mock('frappe-ui/editor', async (importOriginal) => {
  const { defineComponent: define, h: render, onBeforeUnmount, shallowRef } = await import('vue')
  const { Editor } = await import('@tiptap/vue-3')
  const { default: Document } = await import('@tiptap/extension-document')
  const { default: Paragraph } = await import('@tiptap/extension-paragraph')
  const { default: Text } = await import('@tiptap/extension-text')
  const empty = define({ setup: () => () => null })
  return {
    ...(await importOriginal<object>()),
    Editor: define({
      setup(_, { expose }) {
        const editor = shallowRef(new Editor({ extensions: [Document, Paragraph, Text] }))
        expose({ editor })
        onBeforeUnmount(() => editor.value.destroy())
        return () => render('div', { 'data-editor': '' })
      },
    }),
    EditorContent: empty,
    EditorDropZone: empty,
    EditorTableMenu: empty,
    EditorFixedMenu: empty,
  }
})
vi.mock('./core-editor/menu-buttons', () => ({ buildMenuButtons: () => [] }))
vi.mock('./ToC.vue', () => ({ default: { render: () => h('nav', { 'data-toc': '' }) } }))
vi.mock('./ToCMobile.vue', () => ({
  default: { render: () => h('nav', { 'data-toc-mobile': '' }) },
}))
vi.mock('@/apps/drive', () => ({ hasDefaultDocumentTitle: () => false }))
vi.mock('@/apps/writer/composables/useUsers', () => ({
  useUsers: () => ({ users: ref([]) }),
  searchMentions: () => [],
}))
vi.mock('@/stores/root', () => ({ useRootStore: () => ({ paletteOpen: false }) }))

const mounted: App[] = []

afterEach(() => {
  for (const app of mounted.splice(0)) {
    app.unmount()
  }

  document.body.replaceChildren()
})

const COVERS = { version: 'Viewing a version', copy: 'Viewing a recovery copy' }

type Cover = keyof typeof COVERS

function coverSlots(kind: Cover | null) {
  if (!kind) {
    return {}
  }

  return { cover: () => h('div', COVERS[kind]) }
}

function mountWithCover() {
  const cover = ref<Cover | null>(null)
  const host = defineComponent({
    setup: () => () =>
      h(
        CoreEditor,
        {
          file: { doc: { name: 'f1', file_name: 'Untitled' } },
          document: {},
          settings: {},
          editable: true,
        },
        coverSlots(cover.value),
      ),
  })
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(host)
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  mounted.push(app)
  return { root, cover }
}

function shown(root: Element) {
  const scroller = root.querySelector<HTMLElement>('#editor-scroll-container')!
  return {
    isEditorShown: scroller.style.display !== 'none',
    isTocInvisible: root.querySelector('[data-toc]')!.classList.contains('invisible'),
    hasMobileToc: root.querySelector('[data-toc-mobile]') !== null,
  }
}

describe('CoreEditor cover', () => {
  it.each(Object.keys(COVERS) as Cover[])(
    'hides the editor while a %s preview covers it, and shows it again after',
    async (kind) => {
      const { root, cover } = mountWithCover()
      await nextTick()
      expect(shown(root)).toEqual({
        isEditorShown: true,
        isTocInvisible: false,
        hasMobileToc: true,
      })

      cover.value = kind
      await nextTick()
      expect(root.textContent).toContain(COVERS[kind])
      expect(shown(root)).toEqual({
        isEditorShown: false,
        isTocInvisible: true,
        hasMobileToc: false,
      })

      cover.value = null
      await nextTick()
      expect(shown(root)).toEqual({
        isEditorShown: true,
        isTocInvisible: false,
        hasMobileToc: true,
      })
    },
  )
})
