import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { slides: storeSlides, slideIndex } = await import('./slide')
// the store types each slide's fields as unknown, and these tests read them
const slides = fromAny<
  Ref<(Record<string, unknown> & { elements: Record<string, unknown>[] })[]>,
  unknown
>(storeSlides)
const { getCommandsToUpdateElementRefId, getTransitionKey } = await import('./transition')

const element = (id: string, type: string) => ({
  id,
  type,
  left: 10,
  top: 10,
  width: 100,
  height: 100,
  content: '<p>hello</p>',
})

// pairing writes one new refId onto both elements, failing to pair clears the one
const pairedRefId = (element: any) => {
  const [own, ref] = getCommandsToUpdateElementRefId(element)
  return own?.newValue && own.newValue === ref?.newValue ? own.newValue : null
}

describe('magic move refIds', () => {
  beforeEach(() => {
    slides.value = [
      { clientId: 'A', transition: 'Magic Move', elements: [element('e1', 'text')] },
      { clientId: 'B', elements: [element('e2', 'text')] },
    ]
    slideIndex.value = 1
  })

  it('pairs a text element across the transition', () => {
    expect(pairedRefId(slides.value[1].elements[0])).toBeTruthy()
  })

  // the placeholder only shows up on a blank line something has edited, so it must
  // not be what decides that two copies of the same text stopped matching
  it('pairs across a blank line that grew a placeholder on one side', () => {
    slides.value[0].elements[0].content = '<p>hello</p><p></p>'
    slides.value[1].elements[0].content = '<p>hello</p><p>​</p>'

    expect(pairedRefId(slides.value[1].elements[0])).toBeTruthy()
  })

  // a table's columns are pinned in pixels and cannot follow a tweening frame,
  // so it is left out of the pairing and cuts with the slide instead
  it('leaves a table out', () => {
    slides.value[0].elements[0].type = 'table'
    slides.value[1].elements[0].type = 'table'

    expect(getCommandsToUpdateElementRefId(slides.value[1].elements[0])).toEqual([])
  })

  // presentations paired before tables opted out still carry the refId, and the key
  // is what decides whether the node is reused and tweened
  it('keys a table by its own id even when a refId is stored', () => {
    const table = { ...element('e1', 'table'), refId: 'r1' }

    expect(getTransitionKey(table)).toBe('e1')
    expect(getTransitionKey({ ...element('e2', 'text'), refId: 'r1' })).toBe('r1')
  })

  // a saved presentation plays as it did: converted ones carry numeric refIds
  it('keys an element by any refId it holds, a number too, else by its own id', () => {
    expect(getTransitionKey({ ...element('e1', 'image'), refId: 'r1' })).toBe('r1')
    expect(getTransitionKey({ ...element('e1', 'image'), refId: 7 })).toBe(7)
    expect(getTransitionKey(element('e1', 'image'))).toBe('e1')
    expect(getTransitionKey({ ...element('e1', 'image'), refId: '' })).toBe('e1')
  })
})
