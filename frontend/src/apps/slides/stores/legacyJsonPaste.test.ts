import { Editor } from '@tiptap/vue-3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const activeEditor = ref<Editor | null>(null)

vi.mock('frappe-ui', () => ({ toast: { success: vi.fn() }, call: vi.fn() }))
vi.mock('@/apps/slides/stores/presentation', () => ({
  presentationId: ref('p1'),
  presentationDoc: ref(null),
  contextFor: vi.fn(),
  inReadonlyMode: ref(false),
}))
vi.mock('@/apps/slides/stores/slide', () => ({
  slideIndex: ref(0),
  insertSlide: vi.fn(),
  getNewSlide: vi.fn(() => ({ elements: [] })),
}))
vi.mock('@/apps/slides/stores/element', () => ({
  activeElements: ref([]),
  activeElementIds: ref([]),
  isSelectionLocked: ref(false),
  focusElementId: ref('dest'),
  addTextElement: vi.fn(),
  duplicateElements: vi.fn(),
  deleteElements: vi.fn(),
  resetFocus: vi.fn(),
}))
vi.mock('@/apps/slides/stores/imageCrop', () => ({ inCropMode: ref(false) }))
vi.mock('@/apps/slides/composables/useTextEditor', () => ({
  useTextEditor: () => ({ activeEditor }),
}))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({
  getAttachmentUrl: () => '',
  handleUploadedMedia: vi.fn(),
}))

const { extensions } = await import('./tiptapSetup')
const { handlePaste } = await import('./copyPaste')

// the pre-source clipboard payload: a bare array of the copied boxes
async function pasteBox(content: unknown) {
  const elements = JSON.stringify([{ id: 'source', type: 'text', content }])
  const event = {
    target: document.body,
    preventDefault: vi.fn(),
    clipboardData: { getData: (type: string) => (type === 'application/json' ? elements : '') },
  }
  await handlePaste(event)
}

afterEach(() => {
  activeEditor.value?.destroy()
  activeEditor.value = null
})

describe('pasting a copied text box into a focused editor', () => {
  it('draws an old saved document without the weight the old view never drew', async () => {
    activeEditor.value = new Editor({ extensions, content: '<p></p>' })
    const marks = [{ type: 'textStyle', attrs: { fontWeight: '600' } }]
    const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'A', marks }] }

    await pasteBox({ type: 'doc', content: [paragraph] })

    const html = activeEditor.value.getHTML()
    expect(html).toContain('A')
    expect(html).not.toContain('font-weight')
  })

  it('keeps the weight a body saved as HTML draws', async () => {
    activeEditor.value = new Editor({ extensions, content: '<p></p>' })

    await pasteBox('<p><span style="font-weight: 600">A</span></p>')

    expect(activeEditor.value.getHTML()).toContain('font-weight: 600')
  })
})
