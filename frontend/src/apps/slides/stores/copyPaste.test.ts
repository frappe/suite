import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const activeElementIds = ref<string[]>([])
const activeElements = ref<any[]>([])
const presentationDoc = ref<{ is_converted?: number } | null>(null)

vi.mock('frappe-ui', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  call: vi.fn(),
}))
const inReadonlyMode = ref(false)
vi.mock('@/apps/slides/stores/presentation', () => ({
  presentationId: ref('p1'),
  presentationDoc,
  inReadonlyMode,
}))
vi.mock('@/apps/slides/stores/slide', () => ({
  slideIndex: ref(0),
  insertSlide: vi.fn(),
  getNewSlide: vi.fn(() => ({ elements: [] })),
}))
vi.mock('@/apps/slides/stores/element', () => ({
  activeElements,
  activeElementIds,
  isSelectionLocked: ref(false),
  focusElementId: ref(null),
  addTextElement: vi.fn(),
  duplicateElements: vi.fn(),
  deleteElements: vi.fn(),
  resetFocus: vi.fn(),
}))
vi.mock('@/apps/slides/stores/imageCrop', () => ({ inCropMode: ref(false) }))
vi.mock('@/apps/slides/composables/useTextEditor', () => ({
  useTextEditor: () => ({ activeEditor: ref(null) }),
}))
vi.mock('@/apps/slides/utils/helpers', () => ({
  getDocFromHTML: (html: string) => new DOMParser().parseFromString(html, 'text/html'),
  hasListMarkup: (html: string) => !!html && /<(ul|ol|li)[\s>]/i.test(html),
  sanitizeSlideHTML: (html: string) => html,
}))
vi.mock('@/apps/slides/utils/connectors', () => ({
  remapElementIds: (els: any) => els,
}))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({
  handleUploadedMedia: vi.fn(),
}))

const { handleCopy, handleCut, handlePaste } = await import('./copyPaste')
const { insertSlide } = await import('@/apps/slides/stores/slide')
const { toast } = await import('frappe-ui')
const { setLiveSeat } = await import('@/apps/slides/stores/liveDeck')

// assigned after, so the tests read clipboardData as the mocks, not a nullable DataTransfer
const makeCopyEvent = (target: EventTarget | null) =>
  Object.assign(fromPartial<ClipboardEvent>({ target, preventDefault: vi.fn() }), {
    clipboardData: { setData: vi.fn(), getData: vi.fn(() => '') },
  })

beforeEach(() => {
  activeElementIds.value = ['e1']
  activeElements.value = [{ id: 'e1' }]
  presentationDoc.value = null
  document.body.innerHTML = ''
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('handleCopy from editable targets', () => {
  it('lets native copy through from an input (e.g. the color picker hex field)', () => {
    const input = document.createElement('input')
    input.value = '#FF0000'
    document.body.appendChild(input)
    input.focus()
    input.select()

    const e = makeCopyEvent(input)
    handleCopy(e)

    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.clipboardData.setData).not.toHaveBeenCalled()
  })

  it('lets native copy through from a textarea', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    const e = makeCopyEvent(textarea)
    handleCopy(e)

    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.clipboardData.setData).not.toHaveBeenCalled()
  })

  it('lets native copy through from a contenteditable element', () => {
    const editor = document.createElement('div')
    // jsdom does not implement contenteditable focus semantics, so declare
    // the property the guard reads directly
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    document.body.appendChild(editor)
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(editor)

    const e = makeCopyEvent(editor)
    handleCopy(e)

    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.clipboardData.setData).not.toHaveBeenCalled()
  })

  it('falls back to the focused element when the event target is not editable', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(input)

    const e = makeCopyEvent(document.body)
    handleCopy(e)

    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.clipboardData.setData).not.toHaveBeenCalled()
  })
})

describe('handleCopy from the canvas', () => {
  it('still hijacks copy for selected elements', () => {
    const e = makeCopyEvent(document.body)
    handleCopy(e)

    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.clipboardData.setData).toHaveBeenCalledWith(
      'application/json',
      expect.stringContaining('e1'),
    )
  })

  it('still copies the slide when nothing is selected', () => {
    activeElementIds.value = []
    activeElements.value = []

    const e = makeCopyEvent(document.body)
    handleCopy(e)

    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.clipboardData.setData).toHaveBeenCalledWith('application/json', expect.any(String))
    expect(toast.success).toHaveBeenCalledWith('Slide copied to clipboard')
  })
})

describe('handleCut', () => {
  it('copies only the elements the cut removes', () => {
    activeElementIds.value = ['e1', 'e2']
    activeElements.value = [{ id: 'e1', locked: true }, { id: 'e2' }]

    const e = makeCopyEvent(document.body)
    handleCut(e)

    const payload = JSON.parse(e.clipboardData.setData.mock.calls[0][1])
    expect(payload.isCut).toBe(true)
    expect(payload.elements.map((el: any) => el.id)).toEqual(['e2'])
  })
})

describe('handlePaste', () => {
  beforeEach(() => vi.mocked(insertSlide).mockClear())

  const slide = JSON.stringify({ clientId: 's1', parent: 'p1', elements: [] })

  function pasteSlide(json = slide) {
    return handlePaste({
      preventDefault: vi.fn(),
      clipboardData: {
        getData: (type: string) => (type === 'application/json' ? json : ''),
        items: [],
      },
    })
  }

  it('adds a pasted slide to a presentation', async () => {
    await pasteSlide()

    expect(insertSlide).toHaveBeenCalledOnce()
  })

  it('adds nothing for someone who can only view', async () => {
    inReadonlyMode.value = true

    await pasteSlide()
    inReadonlyMode.value = false

    expect(insertSlide).not.toHaveBeenCalled()
  })

  describe('in a live presentation that is offline', () => {
    beforeEach(() => {
      setLiveSeat({
        push() {},
        flush() {},
        undo() {},
        redo() {},
        endStep() {},
        holdsPosition: () => false,
        bindText: () => ({ extensions: [], seeded: false }),
      })
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    })
    afterEach(() => {
      setLiveSeat(null)
      vi.restoreAllMocks()
    })

    it('still pastes a slide copied from the same presentation', async () => {
      await pasteSlide()

      expect(insertSlide).toHaveBeenCalledOnce()
    })

    it('says so and adds nothing when the slide is from another presentation', async () => {
      await pasteSlide(JSON.stringify({ clientId: 's1', parent: 'other', elements: [] }))

      expect(insertSlide).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledOnce()
    })
  })
})
