import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import * as Y from 'yjs'

import {
  addElement,
  addSlide,
  elementIds,
  elementText,
  readSlides,
  ROOT,
  setElement,
  slideIds,
  writeDeck,
} from './deck'
import { drawnSlides } from './drawnDeck'
import { openLiveDeck, type StoreItem, type StoreSlide } from './liveDeck'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const CENTRED = 'translate(-50%, -50%)'
const WIDTH_WHEN_DRAWN = 100

function sharedPair() {
  const [one, other] = [new Y.Doc(), new Y.Doc()]
  one.on('update', (update, origin) => {
    if (origin !== 'wire') Y.applyUpdate(other, update, 'wire')
  })
  other.on('update', (update, origin) => {
    if (origin !== 'wire') Y.applyUpdate(one, update, 'wire')
  })
  return [one, other]
}

function flattenLikeTheEditor(element: StoreItem): StoreItem {
  if (element.transform !== CENTRED) return element
  return {
    ...element,
    left: element.left - WIDTH_WHEN_DRAWN / 2,
    // a longer text wraps to a taller element
    top: element.top - (element.content?.length ?? 0),
    transform: 'none',
    transformOrigin: 'top left',
  }
}

interface TabOptions {
  canWrite?: boolean
  boundElementId?: string | null
}

function tabOn(doc: Y.Doc, { canWrite = true, boundElementId = null }: TabOptions = {}) {
  const store = reactive<{ slides: StoreSlide[] }>({ slides: [] })
  const renamed: Map<string, string>[] = []
  const boundText: (string | null)[] = []
  const deck = openLiveDeck(doc, {
    slides: () => store.slides,
    flatten: flattenLikeTheEditor,
    boundElementId: () => boundElementId,
    setBoundText: (html) => boundText.push(html),
    canWrite: () => canWrite,
    onRenamed: (renames) => renamed.push(renames),
    onMerged: () => {},
    onStep: () => {},
    onBoundDeleted: () => {},
  })
  return {
    store,
    deck,
    renamed,
    boundText,
    element: (id: string) => store.slides.flatMap((s) => s.elements).find((e) => e.id === id)!,
  }
}

function presentation(doc: Y.Doc) {
  writeDeck(doc, [
    {
      id: 's1',
      background: '#111111FF',
      elements: [
        { id: 'a', type: 'image', frame: { left: 1, top: 2, width: 30, height: 40 }, opacity: 100 },
        { id: 'b', type: 'image', frame: { left: 5, top: 6, width: 30, height: 40 }, opacity: 100 },
        { id: 'c', type: 'image', frame: { left: 9, top: 9, width: 30, height: 40 }, opacity: 100 },
      ],
    },
    { id: 's2', elements: [] },
    { id: 's3', elements: [] },
  ])
}

function updatesFrom(doc: Y.Doc, act: () => void) {
  const updates: unknown[] = []
  const listen = (update: Uint8Array) => updates.push(update)
  doc.on('update', listen)
  act()
  doc.off('update', listen)
  return updates
}

function savedFrame(doc: Y.Doc, id: string) {
  return doc.getMap<Y.Map<unknown>>(ROOT.elements).get(id)!.get('frame')
}

describe('pushing the store into the live document', () => {
  it('a changed field reaches the other tab and leaves their change to another field alone', () => {
    const [one, other] = sharedPair()
    presentation(one)
    const tab = tabOn(one)
    setElement(other, 'a', { rotation: 45 })

    tab.element('a').opacity = 50
    tab.deck.push()

    const [saved] = readSlides(other)[0].elements
    expect(saved).toMatchObject({ opacity: 50, rotation: 45 })
  })

  it('writes position and size as one value and nothing the document does not declare', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc)

    tab.element('a').left = 77
    Object.assign(tab.element('a'), { notSaved: 'x' })
    expect(() => tab.deck.push()).not.toThrow()

    expect(savedFrame(doc, 'a')).toEqual({ left: 77, top: 2, width: 30, height: 40 })
    expect(readSlides(doc)[0].elements[0]).not.toHaveProperty('notSaved')
  })

  it('gives a new element the id the write made, in the store and in connector ends', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc)
    const slide = tab.store.slides[0]

    slide.elements.push(
      { id: 'made-here', type: 'image', left: 1, top: 1, zIndex: 4 },
      {
        id: 'line-here',
        type: 'shape',
        left: 2,
        top: 2,
        zIndex: 5,
        connector: { start: { elementId: 'made-here', port: 'top' }, end: null },
      },
    )
    tab.deck.push()

    const [, , , made, line] = slide.elements
    expect(made.id).not.toBe('made-here')
    expect(tab.renamed[0].get('made-here')).toBe(made.id)
    expect(line.connector.start.elementId).toBe(made.id)
    const saved = readSlides(doc)[0].elements.find(({ id }) => id === line.id)
    expect(saved?.connectorStart).toEqual({ elementId: made.id, port: 'top' })
  })

  it('seeds a new element with its text', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc)
    const slide = tab.store.slides[1]

    slide.elements.push({ id: 'x', type: 'text', left: 1, top: 1, content: '<p>hello there</p>' })
    tab.deck.push()

    const [element] = drawnSlides(doc)[1].elements
    expect(element.content).toContain('hello there')
  })

  it('a new slide gets the id the write made and its elements land under it', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc)

    tab.store.slides.splice(1, 0, {
      clientId: 'new-slide',
      background: '#222222FF',
      elements: [{ id: 'y', type: 'image', left: 1, top: 1 }],
    })
    tab.deck.push()

    const added = tab.store.slides[1]
    expect(added.clientId).not.toBe('new-slide')
    expect(slideIds(doc)[1]).toBe(added.clientId)
    expect(elementIds(doc, added.clientId)).toEqual([added.elements[0].id])
  })

  it('deleting a slide removes its elements with it', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc)

    tab.store.slides.splice(0, 1)
    tab.deck.push()

    expect(slideIds(doc)).toEqual(['s2', 's3'])
    expect([...doc.getMap(ROOT.elements).keys()]).toEqual([])
  })

  it('moving one element writes an order on that element alone', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc)
    const orders = () => {
      const elements = doc.getMap<Y.Map<unknown>>(ROOT.elements)
      return Object.fromEntries(['a', 'b', 'c'].map((id) => [id, elements.get(id)!.get('order')]))
    }
    const before = orders()

    // a to the top, as the store's reorder does it: new zIndex values on every element
    tab.element('b').zIndex = 1
    tab.element('c').zIndex = 2
    tab.element('a').zIndex = 3
    tab.deck.push()

    expect(elementIds(doc, 's1')).toEqual(['b', 'c', 'a'])
    expect(orders()).toMatchObject({ b: before.b, c: before.c })
  })

  it('moving a slide reaches the other tab in the new place', () => {
    const [one, other] = sharedPair()
    presentation(one)
    const tab = tabOn(one)

    tab.store.slides.push(tab.store.slides.splice(0, 1)[0])
    tab.deck.push()

    expect(slideIds(other)).toEqual(['s2', 's3', 's1'])
  })

  it('writes nothing when nothing changed', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc)

    expect(updatesFrom(doc, () => tab.deck.push())).toEqual([])
  })

  it('a tab that can only read never writes', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc, { canWrite: false })

    tab.element('a').opacity = 1
    expect(updatesFrom(doc, () => tab.deck.push())).toEqual([])
  })

  it('merges a push of formatted text with what the other tab typed at the same moment', () => {
    const one = new Y.Doc()
    writeDeck(one, [{ id: 's', elements: [{ id: 't', type: 'text', frame: { left: 0, top: 0 } }] }])
    const tab = tabOn(one)
    tab.element('t').content = '<p>alpha beta</p>'
    tab.deck.push()
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one))
    const typed = elementText(other, 't')!.get(0).get(0)
    if (!(typed instanceof Y.XmlText)) throw new Error('expected text')

    typed.insert(typed.length, ' typed')
    tab.element('t').content = '<p><strong>alpha</strong> beta</p>'
    tab.deck.push()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one))
    Y.applyUpdate(one, Y.encodeStateAsUpdate(other))

    for (const doc of [one, other]) {
      const [{ content }] = drawnSlides(doc)[0].elements
      expect(content).toContain('<strong>alpha</strong>')
      expect(content).toContain('typed')
    }
  })

  it('hands text set from outside the editor to the live editor, not to the document', () => {
    const doc = new Y.Doc()
    writeDeck(doc, [{ id: 's', elements: [{ id: 't', type: 'text', frame: { left: 0, top: 0 } }] }])
    const tab = tabOn(doc, { boundElementId: 't' })

    tab.element('t').content = '<p>from the editor</p>'
    tab.deck.push()

    expect(drawnSlides(doc)[0].elements[0].content).not.toContain('from the editor')
    expect(tab.boundText).toEqual(['<p>from the editor</p>'])
  })
})

describe('merging a change from someone else into the store', () => {
  it('updates the same object in place and writes nothing back', () => {
    const [one, other] = sharedPair()
    presentation(one)
    const tab = tabOn(one)
    const shown = tab.element('a')

    const updates = updatesFrom(one, () => setElement(other, 'a', { opacity: 20 }))

    expect(shown.opacity).toBe(20)
    expect(tab.element('a')).toBe(shown)
    expect(updates).toHaveLength(1)
  })

  it('shows an element and a slide another tab added, and drops one they deleted', () => {
    const [one, other] = sharedPair()
    presentation(one)
    const tab = tabOn(one)

    const added = addElement(other, 's2', { type: 'image', frame: { left: 1, top: 1 } })
    const slide = addSlide(other)
    other.getMap(ROOT.elements).delete('b')

    expect(tab.element(added)).toBeTruthy()
    expect(tab.store.slides.map((s) => s.clientId)).toContain(slide)
    expect(tab.element('b')).toBeUndefined()
  })

  it('an edit pending in the store survives a change arriving', () => {
    const [one, other] = sharedPair()
    presentation(one)
    const tab = tabOn(one)

    tab.element('a').opacity = 33
    setElement(other, 'b', { opacity: 44 })

    expect(tab.element('a').opacity).toBe(33)
    expect(readSlides(other)[0].elements[0].opacity).toBe(33)
  })
})

describe('centred text', () => {
  function centredPresentation(doc: Y.Doc) {
    writeDeck(doc, [
      {
        id: 's',
        elements: [
          {
            id: 't',
            type: 'text',
            frame: { left: 500, top: 300, transform: CENTRED, transformOrigin: 'center' },
          },
        ],
      },
    ])
  }

  it('is flattened in memory on open and nothing is written', () => {
    const doc = new Y.Doc()
    centredPresentation(doc)

    let tab!: ReturnType<typeof tabOn>
    const updates = updatesFrom(doc, () => (tab = tabOn(doc)))

    expect(tab.element('t')).toMatchObject({ left: 450, top: 300, transform: 'none' })
    expect(updates).toEqual([])
    expect(savedFrame(doc, 't')).toMatchObject({ left: 500, transform: CENTRED })
  })

  it('saves top-left on the first move', () => {
    const doc = new Y.Doc()
    centredPresentation(doc)
    const tab = tabOn(doc)

    tab.element('t').left = 460
    tab.deck.push()

    expect(savedFrame(doc, 't')).toEqual({
      left: 460,
      top: 300,
      transform: 'none',
      transformOrigin: 'top left',
    })
  })
})

describe('typing in centred text', () => {
  function typedInto(doc: Y.Doc) {
    writeDeck(doc, [
      {
        id: 's',
        elements: [{ id: 't', type: 'text', frame: { left: 500, top: 300, transform: CENTRED } }],
      },
    ])
    const tab = tabOn(doc, { boundElementId: 't' })
    tab.element('t').content = '<p>a much longer line of text</p>'
    tab.deck.push()
    return tab
  }

  it('re-measures the top-left in memory and leaves the saved position centred', () => {
    const doc = new Y.Doc()
    const tab = typedInto(doc)

    expect(tab.element('t').top).toBe(300 - tab.element('t').content.length)
    expect(savedFrame(doc, 't')).toMatchObject({ left: 500, top: 300, transform: CENTRED })
  })
})

describe('a presentation with no slides', () => {
  it('a tab that can edit adds a real blank, and one that can only read does not', () => {
    const viewer = tabOn(new Y.Doc(), { canWrite: false })
    expect(viewer.store.slides).toHaveLength(1)

    const doc = new Y.Doc()
    tabOn(doc)
    expect(slideIds(doc)).toHaveLength(1)
  })
})
