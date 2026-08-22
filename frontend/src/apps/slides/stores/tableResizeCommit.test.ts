import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { activeElementIds, getInitialTableContent } = await import('./element')
const { slides, slideIndex, selectionBounds, updateSelectionBounds } = await import('./slide')
const { interactionOffset, commitInteraction, resetInteractionOffset } = await import('./interaction')
const { setCommandHistory } = await import('./historyMeta')

const element = () => slides.value[0].elements[0] as any

// 3 columns of 101 scale by 1.2 to 121.2 each, rounding to 363 not the 364 dragged to
const table = { rows: 2, cols: 3, columnWidth: 101, dragged: 61 }

describe('committing a table frame resize', () => {
	beforeEach(() => {
		slides.value = [
			{
				clientId: 'c1',
				elements: [
					{
						id: 1,
						type: 'table',
						left: 100,
						top: 50,
						width: table.cols * table.columnWidth,
						// rows are auto height on screen, so the fixture stands in for the DOM
						height: 80,
						content: getInitialTableContent(table.rows, table.cols, table.columnWidth, {}),
					},
				],
			},
		] as any
		slideIndex.value = 0
		activeElementIds.value = [1]
		resetInteractionOffset()
		updateSelectionBounds({ left: 100, top: 50, width: element().width, height: 80 })

		setCommandHistory({ execute: (command: any) => command.execute(slides.value) } as any)
	})

	it('lands on the columns rather than on the cursor', () => {
		interactionOffset.width = table.dragged
		commitInteraction()

		expect(element().width).toBe(363)
	})

	// the next resize measures from the box
	it('takes the selection box with it', async () => {
		interactionOffset.width = table.dragged
		commitInteraction()
		await nextTick()

		expect(selectionBounds.width).toBe(element().width)
	})
})
