import type { CollabRoom, Peer } from '@suite/collab-client'
import { Editor, type EditorOptions } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { absolutePositionToRelativePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { writerAdapter } from './adapter'
import { caretPosition } from './carets'
import { assignColours, PALETTE } from './colours'

const searchUsers = vi.hoisted(() => vi.fn())
vi.mock('@/apps/writer/drive', () => ({ searchUsers }))

const PEER_ID = 2 ** 31 + 7
const NAME_SHOWN_MS = 3000
const editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const BEA: Peer = { pid: PEER_ID, user: 'bea@x.com', arrival: 5, idleSince: null }

// An editor on its own document, or on a copy of another tab's
function openEditor(from?: Y.Doc) {
  const doc = new Y.Doc()
  if (from) {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(from))
  }

  const presenceDoc = new Y.Doc()
  presenceDoc.clientID = 0
  const awareness = new Awareness(presenceDoc)
  const listeners = new Set<() => void>()
  const presence = {
    awareness,
    peers: [BEA],
    ownPid: 2 ** 31 + 1,
    ownArrival: null,
    onChange: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  function roomChanges(peers: Peer[]) {
    presence.peers = peers
    for (const listener of listeners) {
      listener()
    }
  }

  const element = document.createElement('div')
  document.body.append(element)

  const editorOptions: Partial<EditorOptions> = {
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      ...writerAdapter.bind({ doc, presence, onChange: () => () => true } as unknown as CollabRoom),
    ],
  }
  const editor = new Editor(editorOptions)
  editors.push(editor)
  if (!from) {
    editor.commands.insertContent('hello')
  }

  return { editor, awareness, doc, roomChanges }
}

function caretAt(editor: Editor, at: number, to = at) {
  const { type, binding } = ySyncPluginKey.getState(editor.state)
  function toRelative(pos: number) {
    return absolutePositionToRelativePosition(pos, type, binding.mapping, binding.hidden)
  }

  return { anchor: toRelative(at), head: toRelative(to) }
}

function remotePeer(awareness: Awareness) {
  const doc = new Y.Doc()
  doc.clientID = PEER_ID
  const peerAwareness = new Awareness(doc)
  const setPeerState = (state: object | null) => {
    peerAwareness.setLocalState(state)
    const update = encodeAwarenessUpdate(peerAwareness, [PEER_ID])
    applyAwarenessUpdate(awareness, update, 'remote')
  }
  return setPeerState
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// The text in front of the drawn caret, or null when none is drawn
function caretAfter(editor: Editor) {
  const caret = editor.view.dom.querySelector('.collaboration-carets__caret')
  if (!caret) return null

  const range = document.createRange()
  range.setStart(editor.view.dom, 0)
  range.setEndBefore(caret)
  return range.toString()
}

const shadedSelections = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll<HTMLElement>('.collaboration-carets__selection')].map(
    (shade) => [shade.textContent, shade.style.getPropertyValue('--peer-light')],
  )

function caretColour(editor: Editor) {
  const caret = editor.view.dom.querySelector<HTMLElement>('.collaboration-carets__caret')
  return caret?.style.getPropertyValue('--peer-light')
}

// Bea's colour when nobody else in the room has it
const beaColour = assignColours([BEA.user]).get(BEA.user)!

// Someone who arrived before Bea and whose own colour is hers
function earlierRival() {
  for (let index = 0; ; index++) {
    const user = `rival${index}@x.com`
    if (assignColours([user]).get(user) === beaColour) {
      return { pid: PEER_ID + 1, user, arrival: 1, idleSince: null }
    }
  }
}

function isNamed(editor: Editor) {
  const caret = editor.view.dom.querySelector('.collaboration-carets__caret')
  return !caret?.classList.contains('collaboration-carets__caret--quiet')
}

// Bea's caret is drawn at left 100, top 50, and her name is 48px wide, so her named flag spans 100 to 160
// across and 35 to 51 down, its foot just over the top of her line; this tab's own caret sits on the line
// above, under her flag, on her line just after her caret, or well clear of both
const OWN_CARETS = {
  underFlag: { left: 120, right: 120, top: 30, bottom: 46 },
  afterHers: { left: 104, right: 104, top: 50, bottom: 66 },
  clear: { left: 120, right: 120, top: 200, bottom: 216 },
}

function box(edges: { left: number; right: number; top: number; bottom: number }) {
  const width = edges.right - edges.left
  const height = edges.bottom - edges.top
  return { ...edges, x: edges.left, y: edges.top, width, height, toJSON: () => ({}) }
}

function ownCaretAt(editor: Editor) {
  const caret = box({ left: 100, right: 102, top: 50, bottom: 70 })
  const flag = box({ left: 100, right: 160, top: 35, bottom: 51 })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('collaboration-carets__label')) {
      return flag
    }

    return caret
  })
  const ruler = { font: '', measureText: () => ({ width: 48 }) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ruler as never)
  vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true)
  const coords = vi.spyOn(editor.view, 'coordsAtPos')
  return (place: keyof typeof OWN_CARETS) => {
    coords.mockReturnValue(OWN_CARETS[place])
  }
}

// A focused editor, its caret clear of every flag; the test page lays nothing out
function focus(editor: Editor) {
  ownCaretAt(editor)('clear')
}

const labelTexts = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.collaboration-carets__label')].map(
    (label) => label.textContent,
  )

describe('Writer carets', () => {
  it('flags another person’s caret with their first name, and never this tab’s own', async () => {
    const { editor, awareness } = openEditor()
    const peerSays = remotePeer(awareness)
    focus(editor)
    editor.commands.setTextSelection(2)

    let answerLookup = (_: object[]) => {}
    const lookup = new Promise((resolve) => (answerLookup = resolve))
    searchUsers.mockReturnValue(lookup)
    const user = { id: 'bea@x.com' }

    peerSays({ user, cursor: caretAt(editor, 3) })
    await tick()
    const labelsBefore = labelTexts(editor)
    answerLookup([{ name: 'bea@x.com', full_name: 'Bea Writer' }])
    await tick()

    expect(awareness.getLocalState()?.cursor).toHaveProperty('head')
    expect(labelsBefore).toEqual(['bea@x.com'])
    expect(labelTexts(editor)).toEqual(['Bea'])
  })

  it('keeps a peer’s caret where it was while their text is on its way, and drops it when they clear or leave', async () => {
    searchUsers.mockResolvedValue([])
    const { editor, awareness, doc } = openEditor()
    // Their edit has this tab measure its own caret, and the test page lays nothing out
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue(OWN_CARETS.clear)
    const setPeerState = remotePeer(awareness)
    const peerSays = async (state: object | null) => {
      setPeerState(state)
      await tick()
    }

    const user = { id: 'bea@x.com' }
    const peerDoc = new Y.Doc()
    const ourUpdate = Y.encodeStateAsUpdate(doc)
    Y.applyUpdate(peerDoc, ourUpdate)
    const peerVectorBefore = Y.encodeStateVector(peerDoc)
    const paragraph = peerDoc.getXmlFragment('default').get(0) as Y.XmlElement
    const paragraphText = paragraph.get(0) as Y.XmlText
    paragraphText.insert(5, ' world')
    const position = Y.createRelativePositionFromTypeIndex(paragraphText, 8)
    const aheadPosition = Y.relativePositionToJSON(position)
    const aheadCaret = { anchor: aheadPosition, head: aheadPosition }

    await peerSays({ user, cursor: caretAt(editor, 3) })
    const placed = caretAfter(editor)
    await peerSays({ user, cursor: aheadCaret })
    const waiting = caretAfter(editor)
    const theirEdit = Y.encodeStateAsUpdate(peerDoc, peerVectorBefore)
    Y.applyUpdate(doc, theirEdit)
    const arrived = caretAfter(editor)
    await peerSays({ user, cursor: null })
    const cleared = caretAfter(editor)
    await peerSays({ user, cursor: caretAt(editor, 3) })
    await peerSays(null)

    expect([placed, waiting, arrived, cleared]).toEqual(['he', 'he', 'hello wo', null])
    expect(caretAfter(editor)).toBeNull()
  })

  // Ann types at her caret in one tab; the other tab has her words before her caret's next message
  async function typedBeforeTheirCaret(caret: number, typing: string, isBold = false) {
    searchUsers.mockResolvedValue([])
    const ann = openEditor()
    focus(ann.editor)
    ann.editor.chain().setTextSelection({ from: 1, to: 3 }).setMark('bold', {}).run()
    if (!isBold) {
      ann.editor.commands.unsetAllMarks()
    }

    ann.editor.commands.setTextSelection(caret)
    const other = openEditor(ann.doc)
    vi.spyOn(other.editor.view, 'coordsAtPos').mockReturnValue(OWN_CARETS.clear)
    await remoteCaret(other.awareness, ann.awareness)

    ann.editor.commands.insertContent(typing)
    Y.applyUpdate(other.doc, Y.encodeStateAsUpdate(ann.doc, Y.encodeStateVector(other.doc)))
    await tick()
    return [caretAfter(other.editor), shadedSelections(other.editor)]
  }

  async function remoteCaret(awareness: Awareness, theirs: Awareness) {
    remotePeer(awareness)({ user: { id: 'bea@x.com' }, cursor: theirs.getLocalState()?.cursor })
    await tick()
  }

  it('draws a person’s caret after the words they typed at it, unselected, before their caret moves here', async () => {
    const typed = [
      await typedBeforeTheirCaret(6, ' world'),
      await typedBeforeTheirCaret(3, 'XY'),
      await typedBeforeTheirCaret(3, 'XY', true),
    ]

    expect(typed).toEqual([
      ['hello world', []],
      ['heXY', []],
      ['heXY', []],
    ])
  })

  it('keeps this tab’s own caret before words another person types at it', () => {
    const { editor, doc } = openEditor()
    focus(editor)
    editor.commands.setTextSelection(3)

    const theirs = new Y.Doc()
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(doc))
    const theirText = (theirs.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
    theirText.insert(2, 'XY')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(theirs, Y.encodeStateVector(doc)))

    expect([editor.getText(), editor.state.selection.from]).toEqual(['heXYllo', 3])
  })

  it('shades what another person selected in their colour, and nothing for a caret alone', async () => {
    searchUsers.mockResolvedValue([])
    const { editor, awareness } = openEditor()
    const peerSays = remotePeer(awareness)
    const user = { id: 'bea@x.com' }

    peerSays({ user, cursor: caretAt(editor, 2, 5) })
    await tick()
    const selected = shadedSelections(editor)
    const caret = caretColour(editor)
    peerSays({ user, cursor: caretAt(editor, 3) })
    await tick()

    expect(selected).toEqual([['ell', beaColour.light.solid]])
    expect(caret).toBe(beaColour.light.solid)
    expect(shadedSelections(editor)).toEqual([])
  })

  it('repaints a person’s caret and selection when an earlier arrival with their colour joins', async () => {
    searchUsers.mockResolvedValue([])
    const { editor, awareness, roomChanges } = openEditor()
    const peerSays = remotePeer(awareness)
    peerSays({ user: { id: BEA.user }, cursor: caretAt(editor, 2, 5) })
    await tick()

    roomChanges([earlierRival(), BEA])
    await tick()

    const moved = PALETTE[(PALETTE.indexOf(beaColour) + 1) % PALETTE.length].light.solid
    expect(caretColour(editor)).toBe(moved)
    expect(shadedSelections(editor)).toEqual([['ell', moved]])
  })

  it('names a person while they move, select or type, and shrinks the name to a dot three seconds after', async () => {
    vi.useFakeTimers()
    searchUsers.mockResolvedValue([])
    const { editor, awareness } = openEditor()
    const peerSays = remotePeer(awareness)
    const user = { id: 'bea@x.com' }
    const cursor = caretAt(editor, 3)
    const seen: boolean[] = []
    async function after(ms: number) {
      await vi.advanceTimersByTimeAsync(ms)
      seen.push(isNamed(editor))
    }

    peerSays({ user, cursor })
    await after(2900)
    await after(100)
    peerSays({ user, cursor, typed: 1 })
    await after(0)
    await after(3000)
    peerSays({ user, cursor, typed: 1 })
    await after(0)
    peerSays({ user, cursor: caretAt(editor, 2, 4), typed: 1 })
    await after(2900)
    await after(100)

    expect(seen).toEqual([true, false, true, false, false, true, false])
  })

  it('drops a flag to its dot at once while it would sit over this tab’s own caret', async () => {
    const { editor, awareness } = openEditor()
    const peerSays = remotePeer(awareness)
    const user = { id: 'bea@x.com' }
    const placeOwnCaret = ownCaretAt(editor)

    placeOwnCaret('underFlag')
    editor.commands.setTextSelection(5)
    peerSays({ user, cursor: caretAt(editor, 3) })
    await tick()
    const isNamedOnArrival = isNamed(editor)
    placeOwnCaret('clear')
    editor.commands.setTextSelection(1)
    const isNamedWhenClear = isNamed(editor)
    placeOwnCaret('underFlag')
    editor.commands.setTextSelection(4)

    expect([isNamedOnArrival, isNamedWhenClear, isNamed(editor)]).toEqual([false, true, false])
  })

  it('keeps a flag named while this tab’s own caret sits just after theirs on the same line', async () => {
    const { editor, awareness } = openEditor()
    const peerSays = remotePeer(awareness)
    const user = { id: 'bea@x.com' }
    ownCaretAt(editor)('afterHers')
    editor.commands.setTextSelection(4)

    peerSays({ user, cursor: caretAt(editor, 3) })
    await tick()
    const isNamedOnArrival = isNamed(editor)
    peerSays({ user, cursor: caretAt(editor, 3), typed: 1 })
    await tick()

    expect([isNamedOnArrival, isNamed(editor)]).toEqual([true, true])
  })

  it('dims a caret, its flag and dot with it, while its person is idle, and not before', async () => {
    const { editor, awareness, roomChanges } = openEditor()
    const peerSays = remotePeer(awareness)
    focus(editor)
    function isDimmed() {
      const caret = editor.view.dom.querySelector('.collaboration-carets__caret')
      return caret?.classList.contains('collaboration-carets__caret--idle')
    }

    peerSays({ user: { id: BEA.user }, cursor: caretAt(editor, 3) })
    await tick()
    const isDimmedInUse = isDimmed()
    roomChanges([{ ...BEA, idleSince: 1 }])
    await tick()
    const isDimmedIdle = isDimmed()
    roomChanges([BEA])
    await tick()

    expect([isDimmedInUse, isDimmedIdle, isDimmed()]).toEqual([false, true, false])
  })

  it('names a person who moves after another plugin joined the editor', async () => {
    vi.useFakeTimers()
    searchUsers.mockResolvedValue([])
    const { editor, awareness } = openEditor()
    const peerSays = remotePeer(awareness)
    const user = { id: BEA.user }
    focus(editor)

    peerSays({ user, cursor: caretAt(editor, 3) })
    await vi.advanceTimersByTimeAsync(NAME_SHOWN_MS)
    editor.registerPlugin(new Plugin({ key: new PluginKey('late') }))
    peerSays({ user, cursor: caretAt(editor, 2) })
    await vi.advanceTimersByTimeAsync(0)

    expect(isNamed(editor)).toBe(true)
  })

  it('counts this tab’s own typing for other tabs, and not another person’s edits', () => {
    searchUsers.mockResolvedValue([])
    const { editor, awareness, doc } = openEditor()
    focus(editor)
    function typedSoFar() {
      return awareness.getLocalState()?.typed
    }

    const before = typedSoFar()
    editor.commands.insertContent('!')
    editor.commands.insertContent('?')
    const typed = typedSoFar()
    const theirs = new Y.Doc()
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(doc))
    const theirText = (theirs.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
    theirText.insert(0, 'well, ')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(theirs, Y.encodeStateVector(doc)))

    expect([before, typed, typedSoFar()]).toEqual([undefined, 2, 2])
  })

  it('binds the editor to the document’s body', () => {
    const { doc } = openEditor()

    expect(doc.getXmlFragment('default').toString()).toBe('<paragraph>hello</paragraph>')
  })

  it('reads a caret as a pair of relative positions, and nothing else', () => {
    const end = { type: null, tname: 'default', item: { client: 7, clock: 3 }, assoc: 0 }
    const malformed = [
      { anchor: { item: { client: 'x', clock: 1 } }, head: end },
      { anchor: { type: null, tname: null, item: null }, head: end },
      { anchor: end },
      'here',
    ]

    expect(malformed.map(caretPosition)).toEqual([null, null, null, null])
    expect(caretPosition({ anchor: { ...end, stray: 1 }, head: end })).toEqual({
      anchor: end,
      head: end,
    })
  })
})
