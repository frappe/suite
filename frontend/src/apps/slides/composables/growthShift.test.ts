import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Ref } from 'vue'
import { Doc } from 'yjs'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

// the growth math runs off the rendered width, which jsdom can't lay out
const { fakeDiv, renderedWidth } = vi.hoisted(() => {
  const renderedWidth = { measure: () => 100 }
  const fakeDiv = document.createElement('div')
  Object.defineProperty(fakeDiv, 'offsetWidth', {
    get: () => renderedWidth.measure(),
    set: (width) => (renderedWidth.measure = () => width),
  })
  fakeDiv.getBoundingClientRect = () => fromPartial<DOMRect>({ width: renderedWidth.measure() })
  return { fakeDiv, renderedWidth }
})
vi.mock('@/apps/slides/stores/elementRegistry', () => ({
  registerElementDiv: () => {},
  getElementDiv: () => fakeDiv,
}))

const { slides: storeSlides, slideIndex, slideBounds } = await import('@/apps/slides/stores/slide')
// the store types each slide's fields as unknown, and these tests read them
const slides = fromAny<Ref<any[]>, unknown>(storeSlides)
const { activeElementIds, focusElementId, setAutoWidth } =
  await import('@/apps/slides/stores/element')
const { setCommandHistory } = await import('@/apps/slides/stores/historyMeta')
const { useCommandHistory } = await import('./useCommandHistory')
const { useTextEditor } = await import('./useTextEditor')
const { setLiveSeat } = await import('@/apps/slides/stores/liveDeck')
const { openLiveDeck } = await import('@/apps/slides/collab/liveDeck')
const { ROOT, writeDeck } = await import('@/apps/slides/collab/deck')

const { activeEditor } = useTextEditor()

const actionOrder = {
  execute: { editElement: ['execute'], batch: ['execute'] },
  undo: { editElement: ['undo'], batch: ['undo'] },
}

let history: ReturnType<typeof useCommandHistory>

const element = () => slides.value[0].elements[0]

// a tick to drop the old editor, one to mount the new, one to seed the baseline
const editText = async (content: string, overrides = {}) => {
  slides.value = [
    { clientId: 'c1', elements: [{ id: 't1', type: 'text', content, left: 400, ...overrides }] },
  ]
  slideIndex.value = 0
  focusElementId.value = 't1'
  fakeDiv.innerHTML = content
  await nextTick()
  await nextTick()
  await nextTick()
}

const typeAtEnd = (text: string, renderedWidth: number) => {
  Reflect.set(fakeDiv, 'offsetWidth', renderedWidth)
  const editor = activeEditor.value!
  editor.commands.insertContentAt(editor.state.doc.content.size - 1, text)
}

beforeEach(() => {
  slideBounds.scale = 1
  Reflect.set(fakeDiv, 'offsetWidth', 100)
  fakeDiv.contains = () => true
  history = useCommandHistory(slides, { actionOrder, actions: {} })
  setCommandHistory(history)
})

afterEach(() => {
  activeEditor.value?.destroy()
  activeEditor.value = null
  focusElementId.value = null
  activeElementIds.value = []
  slides.value = []
})

describe('growth right after the panel switches back to auto', () => {
  // the box renders at its stored width until the switch clears it
  const switchToAuto = async (autoWidth: number) => {
    renderedWidth.measure = () => element().width ?? autoWidth
    activeElementIds.value = ['t1']
    await setAutoWidth()
    await nextTick()
  }

  it('anchors the first keystroke on the width it collapsed to', async () => {
    await editText('<p style="text-align: center">one</p>', { width: 300 })

    await switchToAuto(100)
    expect(element().left).toBe(500)

    typeAtEnd('x', 120)

    expect(element().left).toBe(490)
  })
})

describe('centred auto-width text typed into while its font loads', () => {
  const CENTRED = 'translate(-50%, -50%)'
  let stopDeck = () => {}

  afterEach(() => {
    stopDeck()
    setLiveSeat(null)
  })

  async function typingInLiveCentredText() {
    const room = new Doc()
    writeDeck(room, [
      {
        id: 's1',
        elements: [{ id: 't1', type: 'text', frame: { left: 500, top: 300, transform: CENTRED } }],
      },
    ])
    const fonts = { pending: false }
    const deck = openLiveDeck(room, {
      slides: () => fromAny(slides.value),
      flatten: (item) =>
        item.transform === CENTRED
          ? { ...item, left: item.left - fakeDiv.offsetWidth / 2, transform: 'none' }
          : item,
      boundElementId: () => 't1',
      isSelected: () => false,
      setBoundText: () => {},
      canWrite: () => true,
      fontsPending: () => fonts.pending,
      onRenamed: () => {},
      onMerged: () => {},
      onStep: () => {},
      onBoundDeleted: () => {},
    })
    stopDeck = deck.stop
    setLiveSeat({
      push: deck.push,
      flush: deck.push,
      undo: deck.undo,
      redo: deck.redo,
      endStep: deck.endStep,
      bindText: () => ({ extensions: [], seeded: false }),
      holdsPosition: deck.holdsPosition,
    })
    fonts.pending = true
    slideIndex.value = 0
    focusElementId.value = 't1'
    await nextTick()
    await nextTick()
    await nextTick()
    // a bound editor's text comes from the room, not from the element
    activeEditor.value!.commands.setContent('<p style="text-align: center">one</p>')
    deck.push()

    const saved = () => room.getMap<Map<string, unknown>>(ROOT.elements).get('t1')!.get('frame')
    return { deck, fonts, saved }
  }

  it('leaves the saved centre alone, then settles it when the font arrives', async () => {
    const { deck, fonts, saved } = await typingInLiveCentredText()

    typeAtEnd('x', 120)
    deck.push()

    expect(element().left).toBe(450)
    expect(saved()).toMatchObject({ left: 500, top: 300, transform: CENTRED })

    fonts.pending = false
    Reflect.set(fakeDiv, 'offsetWidth', 160)
    deck.redraw()

    expect(element().left).toBe(420)
    expect(saved()).toMatchObject({ left: 500, transform: CENTRED })
  })

  it("doesn't pay the font's own width change out of left on the next keystroke", async () => {
    const { deck, fonts, saved } = await typingInLiveCentredText()
    typeAtEnd('x', 120)
    deck.push()
    fonts.pending = false
    Reflect.set(fakeDiv, 'offsetWidth', 160)
    deck.redraw()

    typeAtEnd('y', 180)
    deck.push()

    expect(saved()).toMatchObject({ left: 410, transform: 'none' })
  })
})

describe('alignment-anchored growth of auto-width text', () => {
  it('keeps left-aligned text anchored at its left edge', async () => {
    await editText('<p>one</p>')

    typeAtEnd('x', 120)

    expect(element().left).toBe(400)
  })

  it('grows centered text symmetrically', async () => {
    await editText('<p style="text-align: center">one</p>')

    typeAtEnd('x', 120)

    expect(element().left).toBe(390)
  })

  it('grows right-aligned text leftward', async () => {
    await editText('<p style="text-align: right">one</p>')

    typeAtEnd('x', 120)

    expect(element().left).toBe(380)
  })

  it('shrinks centered text back toward its anchor on deletion', async () => {
    await editText('<p style="text-align: center">one</p>')

    Reflect.set(fakeDiv, 'offsetWidth', 80)
    activeEditor.value!.commands.deleteRange({ from: 1, to: 2 })

    expect(element().left).toBe(410)
  })

  it('leaves mixed-alignment text anchored at its left edge', async () => {
    await editText('<p style="text-align: center">one</p><p>two</p>')

    typeAtEnd('x', 120)

    expect(element().left).toBe(400)
  })

  it('never moves a fixed-width element', async () => {
    await editText('<p style="text-align: center">one</p>', { width: 300 })

    typeAtEnd('x', 120)

    expect(element().left).toBe(400)
  })
})

describe('history of the growth shift', () => {
  it('undoes a coalesced burst back to the original content and left', async () => {
    await editText('<p style="text-align: center">one</p>')

    typeAtEnd('x', 120)
    await nextTick()
    typeAtEnd('y', 140)
    await nextTick()
    expect(element().left).toBe(380)

    history.undo()
    await nextTick()

    expect(element().content).toBe('<p style="text-align: center">one</p>')
    expect(element().left).toBe(400)
  })

  it('redoes a coalesced burst forward to the shifted left', async () => {
    await editText('<p style="text-align: center">one</p>')

    typeAtEnd('x', 120)
    await nextTick()

    Reflect.set(fakeDiv, 'offsetWidth', 100)
    history.undo()
    await nextTick()

    Reflect.set(fakeDiv, 'offsetWidth', 120)
    history.redo()
    await nextTick()

    expect(element().content).toContain('onex')
    expect(element().left).toBe(390)
  })

  it('drops a burst that types and deletes back to the start', async () => {
    // the pop compares against re-serialized content, so seed the normalized form
    await editText('<p style="text-align: center; line-height: 1.5;">one</p>')

    typeAtEnd('x', 120)
    await nextTick()
    Reflect.set(fakeDiv, 'offsetWidth', 100)
    activeEditor.value!.commands.deleteRange({ from: 4, to: 5 })
    await nextTick()

    expect(element().left).toBe(400)
    expect(history.canUndo.value).toBe(false)
  })

  it('starts a fresh entry when the width turns fixed mid-burst', async () => {
    await editText('<p style="text-align: center">one</p>')

    typeAtEnd('x', 120)
    await nextTick()

    // a side-handle drag fixes the width without recording a command
    element().width = 300
    await nextTick()
    expect(() => typeAtEnd('y', 120)).not.toThrow()

    history.undo()
    await nextTick()
    expect(element().content).toContain('onex')
  })

  it('seeds the growth baseline from the mounted editor, not the empty shell', async () => {
    // the element div is an empty shell until EditorContent adopts the view
    fakeDiv.contains = () => false
    Reflect.set(fakeDiv, 'offsetWidth', 2)
    await editText('<p style="text-align: center">one</p>')

    // the view lands in the div and the user clicks a caret in
    fakeDiv.contains = () => true
    Reflect.set(fakeDiv, 'offsetWidth', 100)
    activeEditor.value!.commands.setTextSelection(1)

    typeAtEnd('x', 120)

    expect(element().left).toBe(390)
  })

  it('rebases the growth baseline after a history rewrite', async () => {
    await editText('<p style="text-align: center">one</p>')

    typeAtEnd('x', 120)
    await nextTick()

    // the rewrite lands with the width the undone content renders at
    Reflect.set(fakeDiv, 'offsetWidth', 100)
    history.undo()
    await nextTick()

    typeAtEnd('z', 110)

    expect(element().left).toBe(395)
  })
})
