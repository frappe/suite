import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { addElement, addSlide } from '@/apps/slides/collab/deck'

import type { CompositeAnswer } from './compositeGroups'
import { withSavedSlides } from './compositeSaved'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const rows = [{ client_id: 'row-slide', elements: '[]' }]

function answer(overrides: Partial<CompositeAnswer> = {}): CompositeAnswer {
  return {
    reference: 'r1',
    index: 0,
    presentation: 'P1',
    readable: true,
    node: 'node-1',
    composite: false,
    slides: rows,
    ...overrides,
  }
}

function savedDoc() {
  const doc = new Y.Doc()
  const slide = addSlide(doc, { background: '#123456' })
  addElement(doc, slide, { type: 'image', src: '/saved.png' })
  return doc
}

describe('a combined presentation', () => {
  it('shows what a converted source holds now, not its old rows', async () => {
    const [shown] = await withSavedSlides([answer()], async () => savedDoc())

    expect(shown.slides).toHaveLength(1)
    expect(shown.slides?.[0]).toMatchObject({
      background: '#123456',
      elements: [{ type: 'image', src: '/saved.png' }],
    })
  })

  it('keeps the rows of a source that is not converted', async () => {
    const [shown] = await withSavedSlides([answer()], async () => null)

    expect(shown.slides).toBe(rows)
  })

  it('keeps the rows when the saved state can not be read', async () => {
    const [shown] = await withSavedSlides([answer()], async () => {
      throw new Error('offline')
    })

    expect(shown.slides).toBe(rows)
  })

  it('asks nothing about a source the viewer can not read', async () => {
    const asked: string[] = []
    await withSavedSlides([answer({ readable: false, slides: null })], async (node) => {
      asked.push(node)
      return null
    })

    expect(asked).toEqual([])
  })
})
