import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { convertLegacy, type OldSlide } from './conversion'
import { moveSlide } from './deck'
import { drawnSlides } from './drawnDeck'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const MAX_STATE = 4 * 1024 * 1024

function drawn(slides: OldSlide[]) {
  const answer = convertLegacy({ slides }, MAX_STATE)
  if (answer.kind !== 'converted') {
    throw new Error(JSON.stringify(answer))
  }

  const doc = new Y.Doc()
  Y.applyUpdate(doc, answer.state)
  return drawnSlides(doc)
}

describe('drawing a converted deck', () => {
  it('draws every slide in row order with its background', () => {
    const [first, second] = drawn([
      { id: 'b', background: '#112233FF', elements: [] },
      { id: 'a', background: '#445566FF', elements: [] },
    ])

    expect([first.clientId, second.clientId]).toEqual(['b', 'a'])
    expect([first.background, second.background]).toEqual(['#112233FF', '#445566FF'])
  })

  it("keeps each slide's transition and timing from its old row", () => {
    const [slide] = drawn([
      {
        id: 's',
        transition: 'Fade',
        transitionDuration: 2,
        fadeUnmatchedElements: 1,
        advanceAfter: 5,
        elements: [],
      },
    ])

    expect(slide).toMatchObject({
      transition: 'Fade',
      transitionDuration: 2,
      fadeUnmatchedElements: 1,
      advanceAfter: 5,
    })
  })

  it('numbers the slides from 1 in the order the presentation holds them now', () => {
    const answer = convertLegacy(
      { slides: ['a', 'b', 'c'].map((id) => ({ id, elements: [] })) },
      MAX_STATE,
    )
    if (answer.kind !== 'converted') {
      throw new Error(JSON.stringify(answer))
    }

    const doc = new Y.Doc()
    Y.applyUpdate(doc, answer.state)
    moveSlide(doc, 'a', 'c')

    const numbered = drawnSlides(doc).map(({ clientId, idx }) => [clientId, idx])
    expect(numbered).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ])
  })

  it('puts a box where the old row had it, with its own settings', () => {
    const [{ elements }] = drawn([
      {
        id: 's',
        elements: [
          {
            id: 'pic',
            type: 'image',
            src: '/private/files/old.png',
            left: 10,
            top: 20,
            width: 300,
            height: 200,
            rotation: 15,
          },
        ],
      },
    ])

    expect(elements[0]).toMatchObject({
      id: 'pic',
      type: 'image',
      src: '/private/files/old.png',
      left: 10,
      top: 20,
      width: 300,
      height: 200,
      rotation: 15,
    })
  })

  it('stacks boxes as the old zIndex did', () => {
    const [{ elements }] = drawn([
      {
        id: 's',
        elements: [
          { id: 'top', type: 'image', zIndex: 9 },
          { id: 'bottom', type: 'image', zIndex: 2 },
          { id: 'middle', type: 'image', zIndex: 5 },
        ],
      },
    ])
    const byLayer = [...elements].sort(
      (first, second) => Number(first.zIndex) - Number(second.zIndex),
    )

    expect(byLayer.map(({ id }) => id)).toEqual(['bottom', 'middle', 'top'])
  })

  it('gives a box its text, a marked hard break included', () => {
    const content = '<p><span style="font-size: 24px">one<br>two</span></p>'
    const [{ elements }] = drawn([{ id: 's', elements: [{ id: 'box', type: 'text', content }] }])
    const body = new DOMParser().parseFromString(String(elements[0].content), 'text/html').body

    expect(body.textContent).toBe('onetwo')
    expect(body.querySelector('br')).not.toBeNull()
    expect(body.querySelector('span')?.getAttribute('style')).toContain('font-size: 24px')
  })

  it('gives a connector its two ends and route back in the shape the shapes read', () => {
    const connector = { start: { elementId: 'a', anchor: 'right' }, end: null, route: 'elbow' }
    const [{ elements }] = drawn([
      {
        id: 's',
        elements: [
          { id: 'a', type: 'shape', shapeType: 'rectangle' },
          { id: 'line', type: 'shape', shapeType: 'line', connector },
        ],
      },
    ])
    const line = elements.find(({ id }) => id === 'line')

    expect(line?.connector).toMatchObject({ start: connector.start, route: 'elbow' })
    expect(line).not.toHaveProperty('connectorStart')
    expect(line).not.toHaveProperty('frame')
  })

  it('draws a deck with no slides as one blank', () => {
    const slides = drawn([])

    expect(slides).toHaveLength(1)
    expect(slides[0].elements).toEqual([])
  })
})
