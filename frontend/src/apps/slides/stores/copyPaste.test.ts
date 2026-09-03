import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

const activeElementIds = ref<string[]>([])
const activeElements = ref<any[]>([])

vi.mock('frappe-ui', () => ({
	toast: { success: vi.fn() },
	call: vi.fn(),
}))
vi.mock('@/apps/slides/stores/presentation', () => ({ presentationId: ref('p1') }))
vi.mock('@/apps/slides/stores/slide', () => ({
	slideIndex: ref(0),
	insertSlide: vi.fn(),
	getNewSlide: vi.fn(() => ({ elements: [] })),
}))
vi.mock('@/apps/slides/stores/element', () => ({
	activeElements,
	activeElementIds,
	focusElementId: ref(null),
	addTextElement: vi.fn(),
	duplicateElements: vi.fn(),
	resetFocus: vi.fn(),
}))
vi.mock('@/apps/slides/stores/imageCrop', () => ({ inCropMode: ref(false) }))
vi.mock('@/apps/slides/composables/useTextEditor', () => ({
	useTextEditor: () => ({ activeEditor: ref(null) }),
}))
vi.mock('@/apps/slides/utils/helpers', () => ({
	getDocFromHTML: (html: string) => new DOMParser().parseFromString(html, 'text/html'),
	hasListMarkup: (html: string) => !!html && /<(ul|ol|li)[\s>]/i.test(html),
}))
vi.mock('@/apps/slides/utils/connectors', () => ({
	remapElementIds: (els: any) => els,
}))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({
	handleUploadedMedia: vi.fn(),
}))

const { handleCopy } = await import('./copyPaste')
const { toast } = await import('frappe-ui')

const makeCopyEvent = (target: EventTarget | null) => ({
	target,
	preventDefault: vi.fn(),
	clipboardData: { setData: vi.fn(), getData: vi.fn(() => '') },
})

beforeEach(() => {
	activeElementIds.value = ['e1']
	activeElements.value = [{ id: 'e1' }]
	document.body.innerHTML = ''
	;(document.activeElement as HTMLElement | null)?.blur?.()
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
		handleCopy(e as any)

		expect(e.preventDefault).not.toHaveBeenCalled()
		expect(e.clipboardData.setData).not.toHaveBeenCalled()
	})

	it('lets native copy through from a textarea', () => {
		const textarea = document.createElement('textarea')
		document.body.appendChild(textarea)
		textarea.focus()

		const e = makeCopyEvent(textarea)
		handleCopy(e as any)

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
		handleCopy(e as any)

		expect(e.preventDefault).not.toHaveBeenCalled()
		expect(e.clipboardData.setData).not.toHaveBeenCalled()
	})

	it('falls back to the focused element when the event target is not editable', () => {
		const input = document.createElement('input')
		document.body.appendChild(input)
		vi.spyOn(document, 'activeElement', 'get').mockReturnValue(input)

		const e = makeCopyEvent(document.body)
		handleCopy(e as any)

		expect(e.preventDefault).not.toHaveBeenCalled()
		expect(e.clipboardData.setData).not.toHaveBeenCalled()
	})
})

describe('handleCopy from the canvas', () => {
	it('still hijacks copy for selected elements', () => {
		const e = makeCopyEvent(document.body)
		handleCopy(e as any)

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
		handleCopy(e as any)

		expect(e.preventDefault).toHaveBeenCalled()
		expect(e.clipboardData.setData).toHaveBeenCalledWith('application/json', expect.any(String))
		expect(toast.success).toHaveBeenCalledWith('Slide copied to clipboard')
	})
})
