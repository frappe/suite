import { describe, expect, it, vi } from 'vitest'

vi.mock('@/platform/collab/peers', () => ({}))

const { outlinesOn } = await import('./peerOutlines')

function person(name: string, elements: string[], actedAt: number, count = elements.length) {
  return { key: name, name, colour: undefined, elements, count, actedAt, isIdle: false }
}

const onSlide = new Set(['a', 'b', 'c'])

function view(outlines: ReturnType<typeof outlinesOn>) {
  return outlines.map(({ elementId, person: { name }, label }) => [elementId, name, label])
}

describe('outlinesOn', () => {
  it('outlines every selected element and names the person once, on the first', () => {
    expect(view(outlinesOn([person('Asha', ['b', 'c'], 1)], onSlide))).toEqual([
      ['b', 'Asha', 'Asha'],
      ['c', 'Asha', null],
    ])
  })

  it('ignores elements on another slide, and starts the name on the first one here', () => {
    expect(view(outlinesOn([person('Asha', ['elsewhere', 'c'], 1)], onSlide))).toEqual([
      ['c', 'Asha', 'Asha'],
    ])
  })

  it('reads the full number selected when there are over twenty', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `e${index}`)
    const [first] = outlinesOn([person('Asha', ids, 1, 34)], new Set(ids))

    expect(first.label).toBe('Asha · 34 elements')
  })

  it('does not count up to twenty as a count', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `e${index}`)
    const [first] = outlinesOn([person('Asha', ids, 1)], new Set(ids))

    expect(first.label).toBe('Asha')
  })

  it('gives one element several people on it one tab, for the most recent person', () => {
    const people = [person('Ben', ['a'], 1), person('Asha', ['a'], 3), person('Cy', ['a'], 2)]

    expect(view(outlinesOn(people, onSlide))).toEqual([['a', 'Asha', 'Asha & 2 more']])
  })

  it('replaces the element count on an element shared by several people', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `e${index}`)
    const people = [person('Asha', ids, 2, 34), person('Ben', ['e0'], 1)]

    expect(outlinesOn(people, new Set(ids))[0].label).toBe('Asha & 1 more')
  })

  it('shows no second tab for someone already named on a shared element', () => {
    const people = [person('Asha', ['b', 'a'], 3), person('Ben', ['a'], 1)]
    const labelled = outlinesOn(people, onSlide).filter(({ label }) => label)

    expect(labelled.map(({ elementId, label }) => [elementId, label])).toEqual([
      ['a', 'Asha & 1 more'],
    ])
  })

  it('still names someone whose first element is theirs alone', () => {
    const people = [person('Asha', ['a'], 3), person('Ben', ['b', 'a'], 1)]

    expect(view(outlinesOn(people, onSlide))).toEqual([
      ['a', 'Asha', 'Asha & 1 more'],
      ['b', 'Ben', 'Ben'],
    ])
  })
})
