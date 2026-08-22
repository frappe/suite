import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { addTableElement } = await import('./element')
const { slides, slideIndex, slideBounds } = await import('./slide')
const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')
const { actionOrder, actions, setCommandHistory } = await import('./historyMeta')
const { getTableWidth } = await import('@/apps/slides/utils/tableWidths')

const inserted = () => slides.value[0].elements[0]

beforeEach(() => {
	setCommandHistory(useCommandHistory(slides, { actionOrder, actions }))
	slides.value = [{ clientId: 'c1', background: '#ffffff', elements: [] }] as any
	slideIndex.value = 0
	Object.assign(slideBounds, { width: 960, height: 540, scale: 1 })
})

describe('addTableElement', () => {
	it('keeps a column at its default width while the table fits', async () => {
		await addTableElement(3, 3)

		expect(inserted().width).toBe(450)
		expect(getTableWidth(inserted().content)).toBe(450)
	})

	// the widest the size picker offers, which at the default column width would be
	// centred at left: -120 and hang off both edges of the slide
	it('narrows the columns of a table that would not fit', async () => {
		await addTableElement(3, 8)

		expect(inserted().width).toBe(960)
		expect(inserted().left).toBe(0)
		expect(getTableWidth(inserted().content)).toBe(960)
	})

	it('narrows them by whole pixels, so the frame lands on the columns', async () => {
		await addTableElement(3, 7)

		expect(inserted().width).toBe(getTableWidth(inserted().content))
		expect(inserted().left).toBeGreaterThanOrEqual(0)
	})
})
