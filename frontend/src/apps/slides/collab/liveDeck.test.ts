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
  selected?: string[]
  fontsPending?: boolean
}

function tabOn(
  doc: Y.Doc,
  { canWrite = true, boundElementId = null, selected = [], fontsPending = false }: TabOptions = {},
) {
  const store = reactive<{ slides: StoreSlide[] }>({ slides: [] })
  const renamed: Map<string, string>[] = []
  const boundText: (string | null)[] = []
  const deck = openLiveDeck(doc, {
    slides: () => store.slides,
    flatten: flattenLikeTheEditor,
    boundElementId: () => boundElementId,
    isSelected: (id) => selected.includes(id),
    setBoundText: (html) => boundText.push(html),
    canWrite: () => canWrite,
    restoreRev: () => 0,
    fontsPending: () => fontsPending,
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

function presentationOf(doc: Y.Doc, ids: string[]) {
  writeDeck(doc, [
    { id: 's1', elements: ids.map((id) => ({ id, type: 'image', frame: { left: 1 } })) },
  ])
}

// What two tabs inserting at the same place leave behind once they sync
function tieOrders(items: Y.Map<Y.Map<unknown>>, ids: string[]) {
  const shared = items.get(ids[0])!.get('order')
  for (const id of ids) {
    items.get(id)!.set('order', shared)
  }
}

function tieElements(doc: Y.Doc, ids: string[]) {
  tieOrders(doc.getMap<Y.Map<unknown>>(ROOT.elements), ids)
}

function stack(tab: ReturnType<typeof tabOn>, ids: string[]) {
  ids.forEach((id, at) => {
    tab.element(id).zIndex = at + 1
  })
}

function drawnStack(tab: ReturnType<typeof tabOn>) {
  return [...tab.store.slides[0].elements]
    .sort((one, other) => one.zIndex - other.zIndex)
    .map(({ id }) => id)
}

// Writes, not value changes: a rewrite can land on the value it replaced and still block an undo
function ordersWrittenBy(items: Y.Map<Y.Map<unknown>>, act: () => void) {
  const written = new Set<string>()
  const listen = (events: Y.YEvent<Y.Map<unknown>>[]) => {
    for (const { keys, path } of events) {
      if (keys.has('order')) {
        written.add(String(path[0]))
      }
    }
  }
  items.observeDeep(listen)
  act()
  items.unobserveDeep(listen)
  return [...written].sort()
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

  it.each([
    ['b', ['b', 'a', 'c'], { b: 1, a: 2, c: 3 }],
    ['a', ['b', 'a', 'c'], { b: 1, a: 2, c: 3 }],
  ])('swapping neighbours writes one order, on %s, the element moved', (moved, final, zIndexes) => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc, { selected: [moved] })
    const orders = () => {
      const elements = doc.getMap<Y.Map<unknown>>(ROOT.elements)
      return Object.fromEntries(['a', 'b', 'c'].map((id) => [id, elements.get(id)!.get('order')]))
    }
    const before = orders()

    for (const [id, zIndex] of Object.entries(zIndexes)) {
      tab.element(id).zIndex = zIndex
    }
    tab.deck.push()

    const after = orders()
    expect(elementIds(doc, 's1')).toEqual(final)
    expect(['a', 'b', 'c'].filter((id) => after[id] !== before[id])).toEqual([moved])
  })

  it('bringing two selected elements forward writes orders on those two alone', () => {
    const doc = new Y.Doc()
    writeDeck(doc, [
      {
        id: 's1',
        elements: ['a', 'b', 'c'].map((id) => ({ id, type: 'image', frame: { left: 1 } })),
      },
    ])
    const tab = tabOn(doc, { selected: ['a', 'b'] })
    const orders = () => {
      const elements = doc.getMap<Y.Map<unknown>>(ROOT.elements)
      return Object.fromEntries(['a', 'b', 'c'].map((id) => [id, elements.get(id)!.get('order')]))
    }
    const before = orders()

    for (const [id, zIndex] of Object.entries({ c: 1, a: 2, b: 3 })) {
      tab.element(id).zIndex = zIndex
    }
    tab.deck.push()

    const after = orders()
    expect(elementIds(doc, 's1')).toEqual(['c', 'a', 'b'])
    expect(['a', 'b', 'c'].filter((id) => after[id] !== before[id])).toEqual(['a', 'b'])
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

  it('moving an element between tied neighbours saves the order the tab drew', () => {
    const [one, other] = sharedPair()
    presentationOf(one, ['a', 'b', 'x'])
    tieElements(one, ['a', 'b'])
    const tab = tabOn(one, { selected: ['x'] })
    const otherTab = tabOn(other)

    stack(tab, ['a', 'x', 'b'])
    const changed = ordersWrittenBy(one.getMap(ROOT.elements), () => tab.deck.push())

    expect(elementIds(one, 's1')).toEqual(['a', 'x', 'b'])
    expect(drawnStack(tab)).toEqual(['a', 'x', 'b'])
    expect(drawnStack(otherTab)).toEqual(['a', 'x', 'b'])
    expect(changed).toContain('x')
    expect(changed).toHaveLength(2)
  })

  it('splitting a tie rewrites the smaller side and keeps the larger', () => {
    const doc = new Y.Doc()
    presentationOf(doc, ['a', 'b', 'c', 'x'])
    tieElements(doc, ['a', 'b', 'c'])
    const tab = tabOn(doc, { selected: ['x'] })

    stack(tab, ['a', 'x', 'b', 'c'])
    const changed = ordersWrittenBy(doc.getMap(ROOT.elements), () => tab.deck.push())

    expect(elementIds(doc, 's1')).toEqual(['a', 'x', 'b', 'c'])
    expect(changed).toEqual(['a', 'x'])
  })

  it('leaves a tie alone when the move did not land inside it', () => {
    const doc = new Y.Doc()
    presentationOf(doc, ['a', 'b', 'x', 'y'])
    tieElements(doc, ['a', 'b'])
    const tab = tabOn(doc, { selected: ['y'] })

    stack(tab, ['a', 'b', 'y', 'x'])
    const changed = ordersWrittenBy(doc.getMap(ROOT.elements), () => tab.deck.push())

    expect(elementIds(doc, 's1')).toEqual(['a', 'b', 'y', 'x'])
    expect(changed).toEqual(['y'])
  })

  it('moving a slide between tied neighbours saves the order the tab drew', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const slides = doc.getMap<Y.Map<unknown>>(ROOT.slides)
    tieOrders(slides, ['s1', 's2'])
    const tab = tabOn(doc, { selected: ['s3'] })

    tab.store.slides.splice(1, 0, tab.store.slides.pop()!)
    const changed = ordersWrittenBy(slides, () => tab.deck.push())

    expect(slideIds(doc)).toEqual(['s1', 's3', 's2'])
    expect(changed).toContain('s3')
    expect(changed).toHaveLength(2)
  })

  it('a selected element that kept its place among the others gets no order write', () => {
    const [one, other] = sharedPair()
    presentationOf(one, ['a', 'b', 'c', 'd'])
    const tab = tabOn(one, { selected: ['a', 'c'] })
    const coEditor = tabOn(other, { selected: ['c'] })
    stack(coEditor, ['a', 'b', 'd', 'c'])
    coEditor.deck.push()

    stack(tab, ['b', 'd', 'a', 'c'])
    const changed = ordersWrittenBy(one.getMap(ROOT.elements), () => tab.deck.push())

    expect(elementIds(one, 's1')).toEqual(['b', 'd', 'a', 'c'])
    expect(changed).toEqual(['a'])
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
    const paragraph = elementText(other, 't')!.get(0)
    if (!(paragraph instanceof Y.XmlElement)) throw new Error('expected a paragraph')
    const typed = paragraph.get(0)
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

describe('an edit of centred text that does not move it', () => {
  it('saves top-left too, as the first edit of any kind does', () => {
    const doc = new Y.Doc()
    writeDeck(doc, [
      {
        id: 's',
        elements: [{ id: 't', type: 'text', frame: { left: 500, top: 300, transform: CENTRED } }],
      },
    ])
    const tab = tabOn(doc)

    tab.element('t').opacity = 40
    tab.deck.push()

    expect(savedFrame(doc, 't')).toMatchObject({ left: 450, top: 300, transform: 'none' })
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

  it('saves the re-measured top-left with the first edit', () => {
    const doc = new Y.Doc()
    const tab = typedInto(doc)
    const top = 300 - tab.element('t').content.length

    expect(tab.element('t').top).toBe(top)
    expect(savedFrame(doc, 't')).toEqual({
      left: 450,
      top,
      transform: 'none',
      transformOrigin: 'top left',
    })
  })

  describe('while a font is still loading', () => {
    function centredAt500(doc: Y.Doc) {
      writeDeck(doc, [
        {
          id: 's',
          elements: [{ id: 't', type: 'text', frame: { left: 500, top: 300, transform: CENTRED } }],
        },
      ])
    }

    it('keeps the saved centre when text is typed', () => {
      const doc = new Y.Doc()
      centredAt500(doc)
      const tab = tabOn(doc, { boundElementId: 't', fontsPending: true })

      tab.element('t').content = '<p>a much longer line of text</p>'
      tab.deck.push()

      expect(savedFrame(doc, 't')).toEqual({ left: 500, top: 300, transform: CENTRED })
    })

    it('keeps the saved centre through an edit that moves nothing, and saves the edit', () => {
      const doc = new Y.Doc()
      centredAt500(doc)
      const tab = tabOn(doc, { fontsPending: true })

      tab.element('t').opacity = 40
      tab.deck.push()

      expect(savedFrame(doc, 't')).toEqual({ left: 500, top: 300, transform: CENTRED })
      expect(drawnSlides(doc)[0].elements[0].opacity).toBe(40)
    })

    it('still saves where the element was moved by hand', () => {
      const doc = new Y.Doc()
      centredAt500(doc)
      const tab = tabOn(doc, { fontsPending: true })

      tab.element('t').left = 77
      tab.deck.push()

      expect(savedFrame(doc, 't')).toMatchObject({ left: 77, transform: 'none' })
    })
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

describe("filling a new presentation's blank slide", () => {
  const picture = (id: string, refId: string) => ({
    id,
    type: 'image',
    left: 1,
    top: 2,
    width: 30,
    height: 40,
    refId,
  })
  const light = (): StoreSlide => ({
    clientId: 'light',
    background: '#FFFFFFFF',
    elements: [picture('l1', 'title'), picture('l2', 'body')],
  })
  const dark = (): StoreSlide => ({
    clientId: 'dark',
    background: '#000000FF',
    elements: [picture('d1', 'title'), picture('d2', 'body'), picture('d3', 'footer')],
  })

  // Two tabs on one blank presentation that have not heard from each other yet
  function apart() {
    const [one, other] = [new Y.Doc(), new Y.Doc()]
    writeDeck(one, [{ id: 's1', elements: [] }])
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one))
    return [one, other]
  }

  // The two tabs hear from each other from now on
  function connect(one: Y.Doc, other: Y.Doc) {
    one.on('update', (update, origin) => {
      if (origin !== 'wire') Y.applyUpdate(other, update, 'wire')
    })
    other.on('update', (update, origin) => {
      if (origin !== 'wire') Y.applyUpdate(one, update, 'wire')
    })
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one, Y.encodeStateVector(other)), 'wire')
    Y.applyUpdate(one, Y.encodeStateAsUpdate(other, Y.encodeStateVector(one)), 'wire')
  }

  const refIds = (doc: Y.Doc) => readSlides(doc)[0].elements.map(({ refId }) => refId)

  it('ends on one layout in both tabs when two tabs pick different themes at once', () => {
    const [one, other] = apart()
    const [tabA, tabB] = [tabOn(one), tabOn(other)]

    expect(tabA.deck.fillBlank(light())).toBe(true)
    expect(tabB.deck.fillBlank(dark())).toBe(true)
    connect(one, other)

    const [slide] = readSlides(one)
    expect(readSlides(other)).toEqual(readSlides(one))
    expect(slide.elements).toHaveLength(slide.background === '#FFFFFFFF' ? 2 : 3)
    expect(new Set(refIds(one)).size).toBe(slide.elements.length)
  })

  it('ends on one copy of the layout when two tabs pick the same theme at once', () => {
    const [one, other] = apart()
    const [tabA, tabB] = [tabOn(one), tabOn(other)]

    tabA.deck.fillBlank(light())
    tabB.deck.fillBlank(light())
    connect(one, other)

    expect(refIds(one)).toEqual(['title', 'body'])
    expect(refIds(other)).toEqual(['title', 'body'])
  })

  it('draws the theme that stayed in the tab whose fill gave way, not its own', () => {
    const [one, other] = apart()
    const [tabA, tabB] = [tabOn(one), tabOn(other)]

    tabA.deck.fillBlank(light())
    tabB.deck.fillBlank(dark())
    connect(one, other)

    const kept = readSlides(one)[0].background
    for (const tab of [tabA, tabB]) {
      expect(tab.store.slides).toHaveLength(1)
      expect(tab.store.slides[0].background).toBe(kept)
      expect(tab.store.slides[0].elements).toHaveLength(kept === '#FFFFFFFF' ? 2 : 3)
    }
  })

  it('keeps an element a co-editor added to the blank slide at the same moment', () => {
    const [one, other] = apart()
    const tabA = tabOn(one)
    tabOn(other)

    tabA.deck.fillBlank(light())
    addElement(other, 's1', { type: 'image', frame: { left: 7 } })
    connect(one, other)

    expect(readSlides(one)[0].elements).toHaveLength(3)
    expect(readSlides(other)).toEqual(readSlides(one))
  })

  it('keeps an element of its own fill that the tab moved before the other fill arrived', () => {
    const [one, other] = apart()
    const [tabA, tabB] = [tabOn(one), tabOn(other)]

    tabA.deck.fillBlank(light())
    tabB.deck.fillBlank(light())
    for (const tab of [tabA, tabB]) {
      tab.store.slides[0].elements[0].left = 99
      tab.deck.push()
    }
    connect(one, other)

    // the winner's whole fill, and the one element the other tab moved
    const frames = readSlides(one)[0].elements.map(({ frame }) => frame)
    const moved = frames.filter((frame) =>
      expect.objectContaining({ left: 99 }).asymmetricMatch(frame),
    )
    expect(frames).toHaveLength(3)
    expect(moved).toHaveLength(2)
    expect(readSlides(other)).toEqual(readSlides(one))
  })

  it('leaves the undo steps alone when the slide is no longer blank', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const tab = tabOn(doc)
    tab.element('a').opacity = 50
    tab.deck.push()
    tab.deck.endStep()

    expect(tab.deck.fillBlank(light())).toBe(false)
    tab.deck.undo()

    expect(tab.element('a').opacity).toBe(100)
  })
})
