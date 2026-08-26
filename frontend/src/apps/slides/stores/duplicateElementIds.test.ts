import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: (url: string) => url }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))
vi.mock('@/apps/slides/stores/elementRegistry', () => ({
	registerElementDiv: () => {},
	getElementDiv: () => null,
}))

// jsdom never loads an image, so every probe reports a square
class StubImage {
	naturalWidth = 100
	naturalHeight = 100
	onload: (() => void) | null = null
	onerror: (() => void) | null = null
	set src(_value: string) {
		queueMicrotask(() => this.onload?.())
	}
}
vi.stubGlobal('Image', StubImage)

const { slides, slideIndex, getNewSlide } = await import('./slide')
const { replaceMediaElement } = await import('./element')
const { resetImageCrop } = await import('./imageCrop')
const { setCommandHistory } = await import('./historyMeta')
const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')

const actionOrder = {
	execute: { editElement: ['execute'], batch: ['execute'] },
	undo: { editElement: ['undo'], batch: ['undo'] },
}

const image = (id: string, src: string, overrides = {}) => ({
	id,
	type: 'image',
	src,
	left: 0,
	top: 0,
	width: 100,
	height: 100,
	...overrides,
})

const seedSharedId = (overrides = {}) => {
	slides.value = [
		{ clientId: 'c1', elements: [image('shared', '/files/first.webp', overrides)] },
		{ clientId: 'c2', elements: [image('shared', '/files/second.webp', overrides)] },
	] as any
	slideIndex.value = 1
	setCommandHistory(useCommandHistory(slides, { actionOrder, actions: {} }))
}

describe('a slide inserted from a layout', () => {
	it('takes fresh element ids so repeat inserts never collide', () => {
		const layout = { elements: JSON.stringify([image('fw89mlzl4', '/files/placeholder.webp')]) }

		const first = getNewSlide(false, { ...layout })
		const second = getNewSlide(false, { ...layout })

		expect(first.elements[0].id).not.toBe('fw89mlzl4')
		expect(second.elements[0].id).not.toBe(first.elements[0].id)
	})
})

describe('replacing an image whose id repeats on an earlier slide', () => {
	beforeEach(() => seedSharedId())

	it('swaps the src of the element it was handed', async () => {
		await replaceMediaElement(slides.value[1].elements[0], {
			name: 'File-3',
			file_url: '/files/third.webp',
		})

		expect(slides.value[0].elements[0].src).toBe('/files/first.webp')
		expect(slides.value[1].elements[0].src).toBe('/files/third.webp')
	})
})

describe('resetting the crop of an image whose id repeats on an earlier slide', () => {
	const crop = { x: 0, y: 0, width: 0.5, height: 1 }

	beforeEach(() => seedSharedId({ crop }))

	it('clears the crop of the element it was handed', async () => {
		await resetImageCrop(slides.value[1].elements[0])

		expect(slides.value[0].elements[0].crop).toEqual(crop)
		expect(slides.value[1].elements[0].crop).toBeUndefined()
	})
})
