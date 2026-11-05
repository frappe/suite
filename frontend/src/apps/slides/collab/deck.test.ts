import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  addBox,
  addSlide,
  boxIds,
  boxText,
  deleteBox,
  deleteSlide,
  moveBox,
  moveBoxToSlide,
  moveSlide,
  setBox,
  slideIds,
} from './deck'

const FRAME = { left: 10, top: 10, width: 100, height: 50 }

function tab(clientID: number) {
  const doc = new Y.Doc()
  doc.clientID = clientID

  return doc
}

function sync(tabA: Y.Doc, tabB: Y.Doc) {
  Y.applyUpdate(tabB, Y.encodeStateAsUpdate(tabA, Y.encodeStateVector(tabB)))
  Y.applyUpdate(tabA, Y.encodeStateAsUpdate(tabB, Y.encodeStateVector(tabA)))
}

function setUpText(doc: Y.Doc, id: string, words: string) {
  boxText(doc, id)!.insert(0, [new Y.XmlText(words)])
}

function textOf(doc: Y.Doc, id: string) {
  return (boxText(doc, id)!.get(0) as Y.XmlText).toString()
}

function typeAt(doc: Y.Doc, id: string, index: number, words: string) {
  ;(boxText(doc, id)!.get(0) as Y.XmlText).insert(index, words)
}

function box(doc: Y.Doc, id: string) {
  return doc.getMap<Y.Map<unknown>>('boxes').get(id)!
}

// Three slides with two text boxes each, in two tabs that have synced. A is the
// higher client id, as in the spike
function twoTabs() {
  const [tabA, tabB] = [tab(100), tab(5)]
  const slides = [addSlide(tabA), addSlide(tabA), addSlide(tabA)]
  const boxes = slides.flatMap((slide) => [
    addBox(tabA, slide, { type: 'text', frame: FRAME }),
    addBox(tabA, slide, { type: 'text', frame: FRAME }),
  ])
  setUpText(tabA, boxes[0], 'Hello')
  sync(tabA, tabB)

  return { tabA, tabB, slides, boxes, target: boxes[0] }
}

describe('the spike merge cases on the keyed layout', () => {
  it('moving a box while the other tab types keeps both (case 2)', () => {
    const { tabA, tabB, target } = twoTabs()
    setBox(tabA, target, { frame: { ...FRAME, left: 111 } })
    typeAt(tabB, target, 5, ' world')
    sync(tabA, tabB)
    for (const doc of [tabA, tabB]) {
      expect(box(doc, target).get('frame')).toMatchObject({ left: 111 })
      expect(textOf(doc, target)).toBe('Hello world')
    }
  })

  it('both tabs typing in one box keep both words (case 3)', () => {
    const { tabA, tabB, target } = twoTabs()
    typeAt(tabA, target, 0, 'A ')
    typeAt(tabB, target, 5, ' B')
    sync(tabA, tabB)
    expect(textOf(tabA, target)).toBe('A Hello B')
    expect(textOf(tabB, target)).toBe('A Hello B')
  })

  it('deleting a box while the other tab types drops the edit without error (case 4)', () => {
    const { tabA, tabB, target, boxes } = twoTabs()
    deleteBox(tabA, target)
    typeAt(tabB, target, 5, ' lost')
    sync(tabA, tabB)
    for (const doc of [tabA, tabB]) {
      expect(doc.getMap('boxes').has(target)).toBe(false)
      expect(doc.getMap('boxes').size).toBe(boxes.length - 1)
    }
  })

  it('both tabs moving one slide end the same with no duplicate (case 5)', () => {
    const { tabA, tabB, slides } = twoTabs()
    moveSlide(tabA, slides[0], slides[2])
    moveSlide(tabB, slides[0], slides[2])
    sync(tabA, tabB)
    expect(slideIds(tabA)).toEqual([slides[1], slides[2], slides[0]])
    expect(slideIds(tabB)).toEqual([slides[1], slides[2], slides[0]])
  })

  it('moving a slide while the other tab types keeps both (case 6)', () => {
    const { tabA, tabB, slides, target } = twoTabs()
    moveSlide(tabA, slides[0], slides[2])
    typeAt(tabB, target, 5, ' typed while moving')
    sync(tabA, tabB)
    expect(slideIds(tabB)).toEqual([slides[1], slides[2], slides[0]])
    expect(textOf(tabB, target)).toBe('Hello typed while moving')
  })

  it('moving a box to another slide while the other tab types keeps both (case 7)', () => {
    const { tabA, tabB, slides, target } = twoTabs()
    moveBoxToSlide(tabA, target, slides[1])
    typeAt(tabB, target, 5, ' typed')
    sync(tabA, tabB)
    for (const doc of [tabA, tabB]) {
      expect(box(doc, target).get('parent')).toBe(slides[1])
      expect(boxIds(doc, slides[1])).toContain(target)
      expect(boxIds(doc, slides[0])).not.toContain(target)
      expect(textOf(doc, target)).toBe('Hello typed')
    }
  })
})

// What one Y.Doc update did to the deck, read from the update and not the doc
function writesIn(update: Uint8Array) {
  const { structs, ds } = Y.decodeUpdate(update)

  return { items: structs.filter((struct): struct is Y.Item => struct instanceof Y.Item), ds }
}

// Every key a change wrote, as `id.key`
function keysWritten(doc: Y.Doc, root: string, act: () => void) {
  const written: string[] = []
  function listen(events: Y.YEvent<Y.Map<unknown>>[]) {
    for (const event of events) {
      for (const key of event.changes.keys.keys()) {
        written.push([...event.path, key].join('.'))
      }
    }
  }

  doc.getMap(root).observeDeep(listen)
  act()
  doc.getMap(root).unobserveDeep(listen)

  return written
}

function captureUpdates(doc: Y.Doc, act: () => void) {
  const updates: Uint8Array[] = []
  function listen(update: Uint8Array) {
    updates.push(update)
  }

  doc.on('update', listen)
  act()
  doc.off('update', listen)

  return updates
}

describe('order', () => {
  it('a reorder writes one order value on the moved item only', () => {
    const { tabA, slides } = twoTabs()
    const updates = captureUpdates(tabA, () => {
      expect(keysWritten(tabA, 'slides', () => moveSlide(tabA, slides[0], slides[1]))).toEqual([
        `${slides[0]}.order`,
      ])
    })
    expect(updates).toHaveLength(1)
    expect(writesIn(updates[0]).items).toHaveLength(1)
    expect(slideIds(tabA)).toEqual([slides[1], slides[0], slides[2]])
  })

  it('moving a box writes one order value and leaves the other boxes alone', () => {
    const { tabA, slides } = twoTabs()
    const [first, second] = boxIds(tabA, slides[0])
    expect(keysWritten(tabA, 'boxes', () => moveBox(tabA, first, second))).toEqual([
      `${first}.order`,
    ])
    expect(boxIds(tabA, slides[0])).toEqual([second, first])
  })

  it('moves to the start and end of the deck', () => {
    const { tabA, slides } = twoTabs()
    moveSlide(tabA, slides[2], null)
    expect(slideIds(tabA)).toEqual([slides[2], slides[0], slides[1]])
    moveSlide(tabA, slides[2], slides[1])
    expect(slideIds(tabA)).toEqual([slides[0], slides[1], slides[2]])
  })

  it('two tabs moving different slides into one gap read the same, ties by id', () => {
    const [tabA, tabB] = [tab(100), tab(5)]
    const [first, movedOne, movedTwo, last] = [
      addSlide(tabA),
      addSlide(tabA),
      addSlide(tabA),
      addSlide(tabA),
    ]
    sync(tabA, tabB)
    moveSlide(tabA, movedOne, last)
    moveSlide(tabB, movedTwo, last)
    sync(tabA, tabB)
    const tied = [movedOne, movedTwo].sort()
    expect(slideIds(tabA)).toEqual([first, last, ...tied])
    expect(slideIds(tabB)).toEqual([first, last, ...tied])
  })

  it('a move after a tied item lands after the tie, in the same order everywhere', () => {
    const [tabA, tabB] = [tab(100), tab(5)]
    const [first, second, movedOne, movedTwo, movedThree] = [
      addSlide(tabA),
      addSlide(tabA),
      addSlide(tabA),
      addSlide(tabA),
      addSlide(tabA),
    ]
    sync(tabA, tabB)
    moveSlide(tabA, movedOne, first)
    moveSlide(tabB, movedTwo, first)
    sync(tabA, tabB)
    const tied = [movedOne, movedTwo].sort()
    expect(slideIds(tabA)).toEqual([first, ...tied, second, movedThree])
    moveSlide(tabA, movedThree, tied[0])
    sync(tabA, tabB)
    expect(slideIds(tabA)).toEqual([first, ...tied, movedThree, second])
    expect(slideIds(tabB)).toEqual(slideIds(tabA))
  })

  it('swapping two neighbours hundreds of times never runs out of room', () => {
    const doc = tab(1)
    const [start, movedOne, movedTwo, end] = [
      addSlide(doc),
      addSlide(doc),
      addSlide(doc),
      addSlide(doc),
    ]
    const pairs = [
      [movedOne, movedTwo],
      [movedTwo, movedOne],
    ]
    for (let turn = 0; turn < 300; turn++) {
      const [before, moved] = pairs[turn % pairs.length]
      moveSlide(doc, before, moved)
      expect(slideIds(doc)).toEqual([start, moved, before, end])
    }
  })

  it('sending to the back again and again stays in order', () => {
    const doc = tab(1)
    const ids = Array.from({ length: 4 }, () => addSlide(doc))
    for (let turn = 0; turn < 300; turn++) {
      const last = slideIds(doc).at(-1)!
      moveSlide(doc, last, null)
      const [first] = slideIds(doc)
      expect(first).toBe(last)
    }

    expect(slideIds(doc).toSorted()).toEqual(ids.toSorted())
  })

  it('new slides and boxes land last', () => {
    const doc = tab(1)
    const ids = Array.from({ length: 200 }, () => addSlide(doc))
    expect(slideIds(doc)).toEqual(ids)
    const boxes = Array.from({ length: 200 }, () => addBox(doc, ids[0], { type: 'image' }))
    expect(boxIds(doc, ids[0])).toEqual(boxes)
  })

  it('a new slide goes right after the one named', () => {
    const doc = tab(1)
    const [first, second] = [addSlide(doc), addSlide(doc)]
    const added = addSlide(doc, {}, first)
    expect(slideIds(doc)).toEqual([first, added, second])
  })
})

describe('frame', () => {
  it('two tabs changing one box never mix position and size', () => {
    const { tabA, tabB, target } = twoTabs()
    setBox(tabA, target, { frame: { left: 111, top: 111, width: 111, height: 111 } })
    setBox(tabB, target, { frame: { left: 222, top: 222, width: 222, height: 222 } })
    sync(tabA, tabB)
    // the higher client id wins a clash on one key (spike case 1)
    expect(box(tabA, target).get('frame')).toEqual({ left: 111, top: 111, width: 111, height: 111 })
    expect(box(tabB, target).get('frame')).toEqual({ left: 111, top: 111, width: 111, height: 111 })
  })

  it('keeps the centred form with the position', () => {
    const { tabA, target } = twoTabs()
    const centred = { left: 480, top: 270, transform: 'translate(-50%, -50%)' }
    setBox(tabA, target, { frame: centred })
    expect(box(tabA, target).get('frame')).toEqual(centred)
  })
})

describe('deleting a slide', () => {
  it('takes its boxes in one change and leaves other slides alone', () => {
    const { tabA, tabB, slides, boxes } = twoTabs()
    const updates = captureUpdates(tabA, () => deleteSlide(tabA, slides[0]))
    expect(updates).toHaveLength(1)
    Y.applyUpdate(tabB, updates[0])
    for (const doc of [tabA, tabB]) {
      expect(slideIds(doc)).toEqual([slides[1], slides[2]])
      expect(boxIds(doc, slides[0])).toEqual([])
      expect(boxIds(doc, slides[1])).toEqual(boxes.slice(2, 4))
      expect(boxIds(doc, slides[2])).toEqual(boxes.slice(4, 6))
    }
  })

  it('drops a co-editor typing in one of its boxes without error', () => {
    const { tabA, tabB, slides, target } = twoTabs()
    deleteSlide(tabA, slides[0])
    typeAt(tabB, target, 5, ' lost')
    expect(() => sync(tabA, tabB)).not.toThrow()
    expect(tabB.getMap('boxes').has(target)).toBe(false)
    expect(slideIds(tabB)).toEqual([slides[1], slides[2]])
  })
})

describe('fields', () => {
  it('refuses a name the server would refuse, and writes nothing', () => {
    const doc = tab(1)
    const slide = addSlide(doc)
    const target = addBox(doc, slide, { type: 'image', src: 'n1' })
    expect(() => setBox(doc, target, { zIndex: 3 })).toThrow('zIndex')
    expect(box(doc, target).has('zIndex')).toBe(false)
    expect(() => addSlide(doc, { thumbnail: 'x' })).toThrow('thumbnail')
  })

  it('order and parent change only through a move', () => {
    const doc = tab(1)
    const slide = addSlide(doc)
    const target = addBox(doc, slide, { type: 'image' })
    expect(() => setBox(doc, target, { order: 'V' })).toThrow('order')
    expect(() => setBox(doc, target, { parent: 'x' })).toThrow('parent')
  })

  it('an undefined value clears the key, as unlocking does', () => {
    const doc = tab(1)
    const slide = addSlide(doc)
    const target = addBox(doc, slide, { type: 'image', locked: true })
    setBox(doc, target, { locked: undefined })
    expect(box(doc, target).has('locked')).toBe(false)
  })

  it('writing to a box another tab deleted does not bring it back', () => {
    const { tabA, tabB, target } = twoTabs()
    deleteBox(tabA, target)
    sync(tabA, tabB)
    setBox(tabB, target, { rotation: 5 })
    expect(tabB.getMap('boxes').has(target)).toBe(false)
  })

  it('gives text, shapes and tables a rich text field, and media none', () => {
    const doc = tab(1)
    const slide = addSlide(doc)
    for (const type of ['text', 'shape', 'table']) {
      expect(boxText(doc, addBox(doc, slide, { type }))).toBeInstanceOf(Y.XmlFragment)
    }

    for (const type of ['image', 'video']) {
      expect(boxText(doc, addBox(doc, slide, { type }))).toBeUndefined()
    }
  })
})

describe('what reaches the server', () => {
  it('holds no Y.Array and no Y.Text, only maps and fragments of xml', () => {
    const { tabA, slides, target } = twoTabs()
    const fragment = boxText(tabA, target)!
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.setAttribute('textAlign', 'center')
    const words = new Y.XmlText('bold')
    paragraph.insert(0, [words])
    fragment.insert(1, [paragraph])
    words.format(0, 4, { bold: {} })
    setBox(tabA, target, { points: [{ x: 1, y: 2 }], crop: { x: 0, y: 0 } })
    moveSlide(tabA, slides[0], slides[1])
    deleteSlide(tabA, slides[2])

    const { items } = writesIn(Y.encodeStateAsUpdate(tabA))
    const types = items
      .map((item) => item.content)
      .filter((content) => content instanceof Y.ContentType)
    expect(types.length).toBeGreaterThan(0)
    for (const { type } of types) {
      expect(type.constructor).not.toBe(Y.Array)
      expect(type.constructor).not.toBe(Y.Text)
      expect([Y.Map, Y.XmlFragment, Y.XmlElement, Y.XmlText]).toContain(type.constructor)
    }

    expect(tabA.getMap('slides')).toBeInstanceOf(Y.Map)
    expect(tabA.getMap('boxes')).toBeInstanceOf(Y.Map)
  })
})
