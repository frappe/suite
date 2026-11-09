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

  it('marks only the source whose saved state can not be read', async () => {
    const [broken, fine] = await withSavedSlides(
      [answer(), answer({ reference: 'r2', node: 'node-2' })],
      async (node) => {
        if (node === 'node-1') {
          throw new Error('offline')
        }

        return savedDoc()
      },
    )

    expect(broken).toMatchObject({ reference: 'r1', savedStateFailed: true, slides: null })
    expect(fine.savedStateFailed).toBeUndefined()
    expect(fine.slides?.[0]).toMatchObject({ background: '#123456' })
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
