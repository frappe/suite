import { describe, expect, it, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { flattenNow } = await import('./presentation')

const measure = () => ({ width: 200, height: 100 })

describe('flattenNow', () => {
  it('moves a centred text element to the top-left corner of the same spot', () => {
    const element = { type: 'text', left: 500, top: 300, transform: 'translate(-50%, -50%)' }

    expect(flattenNow(element, measure)).toMatchObject({ left: 400, top: 250, transform: 'none' })
  })

  it('leaves the element it was given as it was', () => {
    const element = { type: 'text', left: 500, top: 300, transform: 'translate(-50%, -50%)' }

    flattenNow(element, measure)

    expect(element).toEqual({
      type: 'text',
      left: 500,
      top: 300,
      transform: 'translate(-50%, -50%)',
    })
  })

  it('does not move an element that is already placed by its corner', () => {
    const element = { type: 'text', left: 500, top: 300, transform: 'none' }

    expect(flattenNow(element, measure)).toMatchObject({ left: 500, top: 300 })
  })

  it('does not touch a picture', () => {
    const image = { type: 'image', left: 10, top: 20, transform: 'translate(-50%, -50%)' }

    expect(flattenNow(image, measure)).toBe(image)
  })
})
