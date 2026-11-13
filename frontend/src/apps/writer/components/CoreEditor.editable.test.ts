import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'

import CoreEditor from './CoreEditor.vue'

vi.mock('./core-editor/WriterToolbar.vue', () => ({ default: { render: () => null } }))
vi.mock('./DocumentTabs.vue', () => ({ default: { render: () => null } }))
vi.mock('./DocumentOutline.vue', () => ({ default: { render: () => null } }))
vi.mock('./ToCMobile.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/drive', () => ({
  driveNodeRoute: () => ({}),
  nodeContentUrl: () => '',
  hasDefaultDocumentTitle: () => false,
  useDriveDialogs: () => ({ pickFile: async () => undefined }),
  useUsers: () => ({ users: ref([]) }),
  searchMentions: () => [],
}))

let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.replaceChildren()
})

function mountEditor() {
  const editable = ref(true)
  const failures: unknown[] = []
  const root = document.body.appendChild(document.createElement('div'))
  app = createApp({
    setup: () => () =>
      h(CoreEditor, {
        file: { doc: { name: 'f1', file_name: 'Untitled' } },
        document: {},
        settings: {},
        editable: editable.value,
      }),
  })
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = (failure) => failures.push(failure)
  app.mount(root)
  return { root, editable, failures }
}

const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve))
  await nextTick()
}

describe('CoreEditor when edit access changes', () => {
  it('keeps the document on screen in both directions', async () => {
    const { root, editable, failures } = mountEditor()
    await settle()
    const textbox = () =>
      root.querySelector('.ProseMirror[role="textbox"][aria-label="Document editor"]')
    expect(textbox()).not.toBeNull()

    for (const value of [false, true, false]) {
      editable.value = value
      await settle()
      expect(failures).toEqual([])
      expect(textbox()).not.toBeNull()
    }
  })
})
