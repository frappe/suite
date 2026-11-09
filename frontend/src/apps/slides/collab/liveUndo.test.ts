import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import * as Y from 'yjs'

import { addSlide, elementIds, elementText, ROOT, setElement, slideIds, writeDeck } from './deck'
import { openLiveDeck, type LiveStep, type StoreItem, type StoreSlide } from './liveDeck'
import { openLiveUndo } from './liveUndo'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const CENTRED = 'translate(-50%, -50%)'

// Two tabs whose changes only cross when the test says so, as on a slow connection
function twoTabsApart() {
  const [one, other] = [new Y.Doc(), new Y.Doc()]
  return {
    one,
    other,
    // Each side's changes leave before it hears the other's, as they do when they cross
    sync() {
      const [fromOne, fromOther] = [Y.encodeStateAsUpdate(one), Y.encodeStateAsUpdate(other)]
      Y.applyUpdate(other, fromOne, 'wire')
      Y.applyUpdate(one, fromOther, 'wire')
    },
  }
}

function twoTabs() {
  const pair = twoTabsApart()
  pair.one.on('update', (update, origin) => {
    if (origin !== 'wire') Y.applyUpdate(pair.other, update, 'wire')
  })
  pair.other.on('update', (update, origin) => {
    if (origin !== 'wire') Y.applyUpdate(pair.one, update, 'wire')
  })
  return pair
}

function flattenCentred(element: StoreItem): StoreItem {
  if (element.transform !== CENTRED) return element
  return { ...element, left: element.left - 50, transform: 'none', transformOrigin: 'top left' }
}

const openTabs: { deck: { stop: () => void } }[] = []

afterEach(() => {
  openTabs.splice(0).forEach(({ deck }) => deck.stop())
})

function tabOn(
  doc: Y.Doc,
  {
    canWrite = true,
    boundElementId = null,
    selected = [],
  }: { canWrite?: boolean; boundElementId?: string | null; selected?: string[] } = {},
) {
  const store = reactive<{ slides: StoreSlide[] }>({ slides: [] })
  const steps: LiveStep[] = []
  const deletedWhileBound: { id: string; heldText: unknown }[] = []
  const element = (id: string) => store.slides.flatMap((s) => s.elements).find((e) => e.id === id)!
  const deck = openLiveDeck(doc, {
    slides: () => store.slides,
    flatten: flattenCentred,
    boundElementId: () => boundElementId,
    isSelected: (id) => selected.includes(id),
    setBoundText: () => {},
    canWrite: () => canWrite,
    onRenamed: () => {},
    onMerged: () => {},
    onStep: (step) => steps.push(step),
    onBoundDeleted: (id) => deletedWhileBound.push({ id, heldText: element(id)?.content }),
  })
  const tab = { store, deck, steps, deletedWhileBound, element }
  openTabs.push(tab)
  return tab
}

function presentation(doc: Y.Doc) {
  writeDeck(doc, [
    {
      id: 's1',
      background: '#111111FF',
      elements: [
        { id: 'a', type: 'image', frame: { left: 1, top: 2, width: 30, height: 40 }, opacity: 100 },
        { id: 'b', type: 'image', frame: { left: 5, top: 6, width: 30, height: 40 }, opacity: 100 },
      ],
    },
    {
      id: 's2',
      elements: [
        { id: 'c', type: 'image', frame: { left: 9, top: 9, width: 30, height: 40 }, opacity: 100 },
      ],
    },
  ])
}

function saved(doc: Y.Doc, id: string) {
  return doc.getMap<Y.Map<any>>(ROOT.elements).get(id) // eslint-disable-line @typescript-eslint/no-explicit-any
}

function leftOf(doc: Y.Doc, id: string) {
  return saved(doc, id)!.get('frame').left
}

function change(tab: ReturnType<typeof tabOn>, edit: () => void) {
  edit()
  tab.deck.endStep()
  tab.deck.push()
}

function editAndDeleteMany(tab: ReturnType<typeof tabOn>) {
  let firstFrame: WeakRef<object> | undefined
  for (let at = 0; at < 250; at++) {
    change(tab, () =>
      tab.store.slides[0].elements.push({ id: `new-${at}`, type: 'image', left: 0 }),
    )
    const element = tab.store.slides[0].elements.at(-1)!
    change(tab, () => (element.left = at + 1))
    if (!firstFrame) {
      firstFrame = new WeakRef(savedFrameOf(tab, element.id))
    }

    change(tab, () => tab.store.slides[0].elements.pop())
  }

  return firstFrame!
}

function savedFrameOf(tab: ReturnType<typeof tabOn>, id: string): object {
  return tab.deck.undoManager.doc.getMap<Y.Map<object>>(ROOT.elements).get(id)!.get('frame')!
}

describe('undo takes back only what this tab did', () => {
  it('leaves a co-editor change to the same element alone', () => {
    const { one, other } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    change(mine, () => (mine.element('a').opacity = 50))
    setElement(other, 'a', { rotation: 45 })
    mine.deck.undo()

    expect(saved(other, 'a')!.get('opacity')).toBe(100)
    expect(saved(other, 'a')!.get('rotation')).toBe(45)
    expect(mine.element('a').rotation).toBe(45)
    expect(mine.element('a').opacity).toBe(100)
  })

  it('has nothing to take back in a tab that only saw a co-editor work', () => {
    const { one, other } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    setElement(other, 'a', { opacity: 20 })
    mine.deck.undo()

    expect(saved(other, 'a')!.get('opacity')).toBe(20)
    expect(mine.steps).toEqual([])
  })

  it('does not count the blank slide a tab adds to an emptied presentation as a step', () => {
    const { one, other } = twoTabs()
    writeDeck(one, [{ id: 's1', elements: [] }])
    const mine = tabOn(one)

    other.getMap(ROOT.slides).delete('s1')
    const [blank] = slideIds(one)
    mine.deck.undo()

    expect(blank).toBeTruthy()
    expect(slideIds(one)).toEqual([blank])
    expect(mine.steps).toEqual([])
  })

  it('does nothing for a tab that may not write', () => {
    const { one } = twoTabs()
    presentation(one)
    let canWrite = true
    const store = reactive<{ slides: StoreSlide[] }>({ slides: [] })
    const steps: LiveStep[] = []
    const deck = openLiveDeck(one, {
      slides: () => store.slides,
      flatten: flattenCentred,
      boundElementId: () => null,
      isSelected: () => false,
      setBoundText: () => {},
      canWrite: () => canWrite,
      onRenamed: () => {},
      onMerged: () => {},
      onStep: (step) => steps.push(step),
      onBoundDeleted: () => {},
    })
    openTabs.push({ deck })
    store.slides[0].elements[0].opacity = 50
    deck.push()
    canWrite = false

    deck.undo()

    expect(saved(one, 'a')!.get('opacity')).toBe(50)
    expect(steps).toEqual([])
  })
})

describe('a blocked undo', () => {
  it('changes nothing, reports where, and the next undo takes the step before', () => {
    const { one, other } = twoTabs()
    presentation(one)
    const mine = tabOn(one)
    change(mine, () => (mine.element('b').left = 500))
    change(mine, () => (mine.element('a').opacity = 50))
    setElement(other, 'a', { opacity: 70 })

    mine.deck.undo()

    expect(saved(other, 'a')!.get('opacity')).toBe(70)
    expect(leftOf(other, 'b')).toBe(500)
    expect(mine.steps).toEqual([
      { direction: 'undo', isBlocked: true, slideId: 's1', elementIds: ['a'] },
    ])

    mine.deck.undo()

    expect(saved(other, 'a')!.get('opacity')).toBe(70)
    expect(leftOf(other, 'b')).toBe(5)
    expect(mine.steps[1]).toMatchObject({ isBlocked: false, elementIds: ['b'] })
  })

  it('undoes the rest of a group move and keeps the element a co-editor changed, with no note', () => {
    const { one, other } = twoTabs()
    presentation(one)
    const mine = tabOn(one)
    change(mine, () => {
      mine.element('a').left = 100
      mine.element('b').left = 200
    })
    setElement(other, 'a', { frame: { left: 777, top: 2, width: 30, height: 40 } })

    mine.deck.undo()

    expect(leftOf(other, 'a')).toBe(777)
    expect(leftOf(other, 'b')).toBe(5)
    expect(mine.steps[0].isBlocked).toBe(false)
  })

  it('a redo a co-editor has since overtaken changes nothing and says so', () => {
    const { one, other } = twoTabs()
    presentation(one)
    const mine = tabOn(one)
    change(mine, () => (mine.element('a').opacity = 50))
    mine.deck.undo()
    setElement(other, 'a', { opacity: 70 })

    mine.deck.redo()

    expect(saved(other, 'a')!.get('opacity')).toBe(70)
    expect(mine.steps[1]).toMatchObject({ direction: 'redo', isBlocked: true })
  })
})

describe('undo after a delete', () => {
  function withText(doc: Y.Doc, id: string, words: string) {
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText(words)])
    elementText(doc, id)!.insert(0, [paragraph])
  }

  it('restores a deleted slide in place, with its elements, text and ids, on both tabs', () => {
    const { one, other } = twoTabs()
    writeDeck(one, [
      { id: 's0', elements: [] },
      {
        id: 's1',
        elements: [
          { id: 't', type: 'text', frame: { left: 1, top: 2, width: 30, height: 40 } },
          { id: 'i', type: 'image', frame: { left: 3, top: 4, width: 30, height: 40 } },
        ],
      },
      { id: 's2', elements: [] },
    ])
    withText(one, 't', 'keep me')
    const mine = tabOn(one)

    change(mine, () => mine.store.slides.splice(1, 1))
    expect(slideIds(other)).toEqual(['s0', 's2'])

    mine.deck.undo()

    expect(slideIds(other)).toEqual(['s0', 's1', 's2'])
    expect(elementIds(other, 's1')).toEqual(['t', 'i'])
    expect(elementText(other, 't')!.toString()).toContain('keep me')
    expect(mine.store.slides.map((slide) => slide.clientId)).toEqual(['s0', 's1', 's2'])
    expect(mine.steps[0]).toMatchObject({ isBlocked: false, slideId: 's1', elementIds: [] })
  })

  it('brings back whole an element a co-editor changed while it was being deleted', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)

    change(mine, () => mine.store.slides[0].elements.shift())
    setElement(other, 'a', { opacity: 25 })
    sync()
    mine.deck.undo()
    sync()

    for (const doc of [one, other]) {
      const restored = saved(doc, 'a')!
      expect(restored.get('type')).toBe('image')
      expect(restored.get('frame')).toEqual({ left: 1, top: 2, width: 30, height: 40 })
      expect(restored.get('opacity')).toBe(25)
    }
    expect(mine.element('a').left).toBe(1)
    expect(mine.element('a').opacity).toBe(25)
  })

  it('brings back a value a co-editor set for the first time while it was being deleted', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)

    change(mine, () => mine.store.slides[0].elements.shift())
    setElement(other, 'a', { rotation: 45 })
    sync()
    mine.deck.undo()
    sync()

    for (const doc of [one, other]) {
      expect(saved(doc, 'a')!.get('rotation')).toBe(45)
    }
  })

  it('brings back what a co-editor wrote when their tab heard of the delete first', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)
    const theirs = tabOn(other)

    // a new key on purpose: replacing one makes their undo hold the element, which hides this
    change(theirs, () => (theirs.element('a').rotation = 45))
    change(mine, () => mine.store.slides[0].elements.shift())
    // the delete reaches them, and only then does their state reach this tab: cleaned of those values
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one), 'wire')
    Y.applyUpdate(one, Y.encodeStateAsUpdate(other), 'wire')
    mine.deck.undo()
    sync()
    sync()

    for (const doc of [one, other]) {
      expect(saved(doc, 'a')!.get('rotation')).toBe(45)
    }
  })

  it('puts back an added key when only the server was left to carry it, and it had cleaned it', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)
    const theirs = tabOn(other)
    const server = new Y.Doc()
    Y.applyUpdate(server, Y.encodeStateAsUpdate(one), 'wire')

    change(theirs, () => (theirs.element('a').rotation = 45))
    change(mine, () => mine.store.slides[0].elements.shift())
    Y.applyUpdate(server, Y.encodeStateAsUpdate(other), 'wire')
    Y.applyUpdate(server, Y.encodeStateAsUpdate(one), 'wire')
    Y.applyUpdate(other, Y.encodeStateAsUpdate(server), 'wire')
    Y.applyUpdate(one, Y.encodeStateAsUpdate(server), 'wire')
    mine.deck.undo()
    sync()
    sync()

    for (const doc of [one, other]) {
      expect(saved(doc, 'a')!.get('rotation')).toBe(45)
    }
  })

  it('never writes a held value over a live edit made after the restore', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)
    const theirs = tabOn(other)
    const third = new Y.Doc()

    change(theirs, () => (theirs.element('a').opacity = 25))
    change(mine, () => mine.store.slides[0].elements.shift())
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one), 'wire')
    mine.deck.undo()
    Y.applyUpdate(third, Y.encodeStateAsUpdate(one), 'wire')
    saved(third, 'a')!.set('opacity', 70)
    Y.applyUpdate(other, Y.encodeStateAsUpdate(third), 'wire')
    sync()
    sync()

    for (const doc of [one, other]) {
      expect(saved(doc, 'a')!.get('opacity')).toBe(70)
    }
  })

  it('holds the 2,000 newest deleted items and lets go of older ones', () => {
    const doc = new Y.Doc()
    const elements = doc.getMap<Y.Map<unknown>>(ROOT.elements)
    const ids = Array.from({ length: 2050 }, (_, at) => `e${at}`)
    ids.forEach((id) => elements.set(id, new Y.Map()))
    const steps = openLiveUndo(doc, ['mine'])

    for (const id of ids) {
      doc.transact(() => elements.get(id)!.set('rotation', 45), 'mine')
    }

    for (const id of ids) {
      doc.transact(() => elements.delete(id), 'wire')
    }

    doc.transact(() => ids.forEach((id) => elements.set(id, new Y.Map())), 'wire')
    steps.writeBackOwn()

    expect(ids.filter((id) => elements.get(id)!.has('rotation'))).toEqual(ids.slice(50))
  })

  it('gives back what a co-editor added to 201 elements this tab deleted together', () => {
    const { one, other, sync } = twoTabsApart()
    const ids = Array.from({ length: 201 }, (_, at) => `e${at}`)
    const frame = { left: 1, top: 2, width: 30, height: 40 }
    writeDeck(one, [{ id: 's1', elements: ids.map((id) => ({ id, type: 'image', frame })) }])
    sync()
    const mine = tabOn(one)
    const theirs = tabOn(other)

    for (const id of ids) {
      theirs.element(id).rotation = 45
    }
    theirs.deck.push()
    mine.store.slides[0].elements = []
    mine.deck.push()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one), 'wire')
    Y.applyUpdate(one, Y.encodeStateAsUpdate(other), 'wire')

    mine.deck.undo()
    sync()
    sync()

    expect(ids.filter((id) => saved(one, id)?.get('rotation') !== 45)).toEqual([])
    expect(ids.filter((id) => saved(other, id)?.get('rotation') !== 45)).toEqual([])
  })

  it('takes back a move of one element past its neighbour', () => {
    const doc = new Y.Doc()
    presentation(doc)
    const mine = tabOn(doc, { selected: ['b'] })

    mine.element('b').zIndex = 1
    mine.element('a').zIndex = 2
    mine.deck.push()
    expect(elementIds(doc, 's1')).toEqual(['b', 'a'])

    mine.deck.undo()

    expect(elementIds(doc, 's1')).toEqual(['a', 'b'])
  })

  it('leaves the restored values alone when the co-editor wrote nothing', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)
    tabOn(other)
    const writes = vi.fn()

    change(mine, () => mine.store.slides[0].elements.shift())
    sync()
    mine.deck.undo()
    other.on('update', (_update, origin) => {
      if (origin !== 'wire') writes()
    })
    sync()

    expect(writes).not.toHaveBeenCalled()
  })

  it('falls back to what the tab last saw when the co-editor value never reached it', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)

    change(mine, () => mine.store.slides[0].elements.shift())
    setElement(other, 'a', { opacity: 25 })
    // sent after hearing of the delete, so the value has already been cleaned up there
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one), 'wire')
    Y.applyUpdate(one, Y.encodeStateAsUpdate(other), 'wire')
    mine.deck.undo()
    sync()

    for (const doc of [one, other]) {
      expect(saved(doc, 'a')!.get('opacity')).toBe(100)
    }
  })

  it('brings back whole a slide a co-editor changed while it was being deleted', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)

    change(mine, () => mine.store.slides.shift())
    other.getMap<Y.Map<unknown>>(ROOT.slides).get('s1')!.set('background', '#222222FF')
    sync()
    mine.deck.undo()
    sync()

    for (const doc of [one, other]) {
      expect(slideIds(doc)).toEqual(['s1', 's2'])
      expect(doc.getMap<Y.Map<unknown>>(ROOT.slides).get('s1')!.get('background')).toBe('#222222FF')
      expect(elementIds(doc, 's1')).toEqual(['a', 'b'])
    }
  })

  it('writing back what was missing leaves the redo in place', () => {
    const { one, other, sync } = twoTabsApart()
    presentation(one)
    sync()
    const mine = tabOn(one)

    change(mine, () => mine.store.slides[0].elements.shift())
    setElement(other, 'a', { opacity: 25 })
    sync()
    mine.deck.undo()
    mine.deck.redo()

    expect(saved(one, 'a')).toBeUndefined()
    expect(mine.steps[1]).toMatchObject({ direction: 'redo', isBlocked: false })
  })
})

describe('what makes one step', () => {
  it('releases an edited and deleted element after its undo steps expire', async () => {
    const doc = new Y.Doc()
    writeDeck(doc, [{ id: 's1', elements: [] }])
    const mine = tabOn(doc)
    const firstFrame = editAndDeleteMany(mine)
    // Weak references stay alive until this job ends, even after all owners let go
    await new Promise((resolve) => setTimeout(resolve, 0))
    setFlagsFromString('--expose_gc')
    // SAFETY: V8 exposes a callable `gc` in new contexts while this flag is enabled
    const collect = runInNewContext('gc') as () => void
    setFlagsFromString('--no-expose_gc')
    collect()

    expect(firstFrame.deref()).toBeUndefined()
    mine.deck.undo()
    expect(mine.store.slides[0].elements).toEqual([
      expect.objectContaining({ type: 'image', left: 250 }),
    ])
  })

  it('takes back everything one push wrote in one undo', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    change(mine, () => {
      mine.element('a').left = 10
      mine.element('a').top = 20
      mine.element('b').left = 30
    })
    mine.deck.undo()

    expect(leftOf(one, 'a')).toBe(1)
    expect(saved(one, 'a')!.get('frame').top).toBe(2)
    expect(leftOf(one, 'b')).toBe(5)
  })

  it('keeps two quick moves apart', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    change(mine, () => (mine.element('a').left = 10))
    change(mine, () => (mine.element('a').left = 20))
    mine.deck.undo()

    expect(leftOf(one, 'a')).toBe(10)
  })

  it('does not fold quick typing into the move before it', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    change(mine, () => (mine.element('a').left = 10))
    mine.element('b').opacity = 40
    mine.deck.push()
    mine.deck.undo()

    expect(saved(one, 'b')!.get('opacity')).toBe(100)
    expect(leftOf(one, 'a')).toBe(10)
  })

  it('groups edits with no pause and splits them at one', async () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    mine.element('a').opacity = 90
    mine.deck.push()
    mine.element('a').opacity = 80
    mine.deck.push()
    await new Promise((resolve) => setTimeout(resolve, 520))
    mine.element('a').opacity = 70
    mine.deck.push()

    mine.deck.undo()
    expect(saved(one, 'a')!.get('opacity')).toBe(80)
    mine.deck.undo()
    expect(saved(one, 'a')!.get('opacity')).toBe(100)
  })

  it('holds the last 200 steps', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)
    for (let left = 1000; left < 1205; left++) {
      change(mine, () => (mine.element('a').left = left))
    }

    for (let press = 0; press < 205; press++) {
      mine.deck.undo()
    }

    expect(leftOf(one, 'a')).toBe(1004)
    expect(mine.steps).toHaveLength(200)
  })

  it('retains only what its 200 steps can undo, however many separate moves were made', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)
    for (let left = 1000; left < 3000; left++) {
      change(mine, () => (mine.element('a').left = left))
    }

    const frames = [...one.store.clients.values()]
      .flat()
      .flatMap((struct) => (struct instanceof Y.Item ? struct.content.getContent() : []))
      .filter((value) => value?.left !== undefined)
    // one value replaced per step, and the current frames of the three elements
    expect(frames).toHaveLength(203)

    for (let press = 0; press < 201; press++) {
      mine.deck.undo()
    }

    expect(mine.element('a').left).toBe(2799)
  })

  it('lets go of what the oldest step held once it falls off the limit', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)
    const isHeld = (left: number) => {
      const structs = [...one.store.clients.values()].flat()
      return structs.some(
        (struct) =>
          struct instanceof Y.Item &&
          struct.keep &&
          struct.content.getContent().some((value) => value?.left === left),
      )
    }
    // two elements in turn, as Yjs joins repeat writes to one key into a single item
    for (let left = 1000; left < 1204; left++) {
      change(mine, () => (mine.element(left % 2 ? 'b' : 'a').left = left))
    }

    // four steps fell off, and each held the value its write replaced
    expect(isHeld(1000)).toBe(false)
    expect(isHeld(1001)).toBe(false)
    expect(isHeld(1002)).toBe(true)
  })

  it('a new change drops what redo held', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)
    change(mine, () => (mine.element('a').left = 10))
    mine.deck.undo()
    change(mine, () => (mine.element('a').left = 20))

    mine.deck.redo()

    expect(leftOf(one, 'a')).toBe(20)
  })

  it('a text seeded when an editor opens is no step of its own', () => {
    const { one } = twoTabs()
    writeDeck(one, [
      {
        id: 's1',
        elements: [{ id: 't', type: 'text', frame: { left: 1, top: 2, width: 30, height: 40 } }],
      },
    ])
    const mine = tabOn(one)

    mine.deck.seedText('t', '<p>first text</p>')
    mine.deck.undo()

    expect(elementText(one, 't')!.toString()).toContain('first text')
    expect(mine.steps).toEqual([])
  })
})

describe('where undo and redo land', () => {
  it('names the slide and the element it changed, wherever the tab is now', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    change(mine, () => (mine.element('c').left = 400))
    mine.deck.undo()
    mine.deck.redo()

    expect(mine.steps).toEqual([
      { direction: 'undo', isBlocked: false, slideId: 's2', elementIds: ['c'] },
      { direction: 'redo', isBlocked: false, slideId: 's2', elementIds: ['c'] },
    ])
  })

  it('selects every element of a group move', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    change(mine, () => {
      mine.element('a').left = 10
      mine.element('b').left = 20
    })
    mine.deck.undo()

    expect([...mine.steps[0].elementIds].sort()).toEqual(['a', 'b'])
  })

  it('goes to the slide of an element the undo removed, and selects nothing', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)
    change(mine, () => mine.store.slides[1].elements.push({ id: 'new', type: 'image', left: 1 }))

    mine.deck.undo()

    expect(mine.steps[0]).toMatchObject({ slideId: 's2', elementIds: [] })
    expect(elementIds(one, 's2')).toEqual(['c'])
  })

  it('names the slide alone for an undone slide change', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one)

    change(mine, () => (mine.store.slides[1].background = '#00FF00FF'))
    mine.deck.undo()

    expect(mine.steps[0]).toMatchObject({ slideId: 's2', elementIds: [] })
  })
})

describe('undoing the first edit of centred text', () => {
  it('puts back the centred form in the same spot', () => {
    const { one } = twoTabs()
    writeDeck(one, [
      {
        id: 's1',
        elements: [
          {
            id: 't',
            type: 'text',
            frame: { left: 480, top: 270, width: 100, height: 40, transform: CENTRED },
          },
        ],
      },
    ])
    const mine = tabOn(one)
    const flatLeft = mine.element('t').left

    change(mine, () => (mine.element('t').left = flatLeft + 25))
    expect(saved(one, 't')!.get('frame').transform).not.toBe(CENTRED)

    mine.deck.undo()

    expect(saved(one, 't')!.get('frame')).toMatchObject({ left: 480, transform: CENTRED })
    expect(mine.element('t').left).toBe(flatLeft)
  })

  it('puts it back when that first edit was typing', () => {
    const { one } = twoTabs()
    writeDeck(one, [
      {
        id: 's1',
        elements: [
          {
            id: 't',
            type: 'text',
            frame: { left: 480, top: 270, width: 100, height: 40, transform: CENTRED },
          },
        ],
      },
    ])
    const mine = tabOn(one, { boundElementId: 't' })

    change(mine, () => (mine.element('t').content = '<p>typed</p>'))
    expect(saved(one, 't')!.get('frame').transform).not.toBe(CENTRED)

    mine.deck.undo()

    expect(saved(one, 't')!.get('frame')).toMatchObject({ left: 480, transform: CENTRED })
  })
})

describe('an element deleted under the person typing in it', () => {
  it('reports it once, while the typed text is still in the store', () => {
    const { one, other } = twoTabs()
    presentation(one)
    const mine = tabOn(one, { boundElementId: 'a' })
    mine.element('a').content = '<p>typed here</p>'
    mine.deck.push()

    other.getMap(ROOT.elements).delete('a')
    addSlide(other)

    expect(mine.deletedWhileBound).toEqual([{ id: 'a', heldText: '<p>typed here</p>' }])
  })

  it('reports a second delete of the same element after it came back', () => {
    const { one, other } = twoTabs()
    presentation(one)
    const mine = tabOn(one, { boundElementId: 'a' })
    const deleter = tabOn(other)

    change(deleter, () => deleter.store.slides[0].elements.shift())
    deleter.deck.undo()
    mine.element('a').content = '<p>typed again</p>'
    mine.deck.push()
    change(deleter, () => deleter.store.slides[0].elements.shift())

    expect(mine.deletedWhileBound.map(({ id }) => id)).toEqual(['a', 'a'])
    expect(mine.deletedWhileBound[1].heldText).toBe('<p>typed again</p>')
  })

  it('is not reported for a delete the tab caused with its own undo', () => {
    const { one } = twoTabs()
    presentation(one)
    const mine = tabOn(one, { boundElementId: 'new' })
    change(mine, () => mine.store.slides[1].elements.push({ id: 'new', type: 'image', left: 1 }))

    mine.deck.undo()

    expect(mine.deletedWhileBound).toEqual([])
  })
})
