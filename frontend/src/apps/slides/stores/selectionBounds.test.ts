import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { cropSelectionToFitContent } = await import('./element')
const { slides, slideIndex, selectionBounds, updateSelectionBounds } = await import('./slide')
const { interactionOffset, resetInteractionOffset } = await import('./interaction')

// SelectionBox renders at selectionBounds minus the offset and re-adds it as a
// transform, so bounds written mid-gesture have to already include the offset
describe('cropSelectionToFitContent during a live gesture', () => {
  beforeEach(() => {
    slides.value = [
      {
        clientId: 'c1',
        elements: [{ id: 1, type: 'text', left: 100, top: 50, width: 200, height: 40 }],
      },
    ] as any
    slideIndex.value = 0
    resetInteractionOffset()
    updateSelectionBounds({ left: 100, top: 50, width: 200, height: 40 })
  })

  it('leaves the box on the element when nothing is in flight', () => {
    cropSelectionToFitContent([1])

    expect(selectionBounds.left).toBe(100)
    expect(selectionBounds.top).toBe(50)
  })

  it('follows the element while a drag offset is uncommitted', () => {
    interactionOffset.left = -64
    interactionOffset.top = 12

    cropSelectionToFitContent([1])

    expect(selectionBounds.left).toBe(36)
    expect(selectionBounds.top).toBe(62)
  })
})
