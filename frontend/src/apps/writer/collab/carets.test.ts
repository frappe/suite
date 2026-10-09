import type { Peer } from '@suite/collab-client'
import { Editor, type EditorOptions } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { absolutePositionToRelativePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { Carets, peopleOf } from './carets'

const searchUsers = vi.hoisted(() => vi.fn())
vi.mock('@/apps/writer/drive', () => ({ searchUsers }))

const PEER = 2 ** 31 + 7
const editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  vi.useRealTimers()
})

function open() {
  const doc = new Y.Doc()
  const scratch = new Y.Doc()
  scratch.clientID = 0
  const awareness = new Awareness(scratch)
  const presence = { awareness, peers: [], onChange: () => () => true }
  const element = document.createElement('div')
  document.body.append(element)

  const editorOptions: Partial<EditorOptions> = {
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: doc }),
      Carets.configure({ presence }),
    ],
  }
  const editor = new Editor(editorOptions)
  editors.push(editor)
  editor.commands.insertContent('hello')
  return { editor, awareness, doc }
}

function caretAt(editor: Editor, at: number, to = at) {
  const { type, binding } = ySyncPluginKey.getState(editor.state)
  const place = (pos: number) => absolutePositionToRelativePosition(pos, type, binding.mapping)
  return { anchor: place(at), head: place(to) }
}

function peer(awareness: Awareness) {
  const doc = new Y.Doc()
  doc.clientID = PEER
  const own = new Awareness(doc)
  const say = (state: object | null) => {
    own.setLocalState(state)
    const update = encodeAwarenessUpdate(own, [PEER])
    applyAwarenessUpdate(awareness, update, 'remote')
  }
  return say
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

const shades = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll<HTMLElement>('.collaboration-carets__selection')].map(
    (shade) => [shade.textContent, shade.style.backgroundColor],
  )

const idle = (editor: Editor) =>
  editor.view.dom
    .querySelector('.collaboration-carets__label')
    ?.classList.contains('collaboration-carets__label--idle')

const labels = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.collaboration-carets__label')].map(
    (label) => label.textContent,
  )

describe('Writer carets', () => {
  it('draws another person’s caret by their full name, and never this tab’s own', async () => {
    const { editor, awareness } = open()
    const peerSays = peer(awareness)
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true)
    editor.commands.setTextSelection(2)

    let answer = (_: object[]) => {}
    const lookup = new Promise((resolve) => (answer = resolve))
    searchUsers.mockReturnValue(lookup)
    const user = { id: 'bea@x.com', color: '#3E63DD' }

    peerSays({ user, cursor: caretAt(editor, 3) })
    await tick()
    const before = labels(editor)
    answer([{ name: 'bea@x.com', full_name: 'Bea Writer' }])
    await tick()

    expect(awareness.getLocalState()?.cursor).toHaveProperty('head')
    expect(before).toEqual(['bea@x.com'])
    expect(labels(editor)).toEqual(['Bea Writer'])
  })

  it('keeps a peer’s caret where it was while their text is on its way, and drops it when they clear or leave', async () => {
    searchUsers.mockResolvedValue([])
    const { editor, awareness, doc } = open()
    const say = peer(awareness)
    const peerSays = async (state: object | null) => {
      say(state)
      await tick()
    }
    const user = { id: 'bea@x.com', color: '#3E63DD' }
    const theirs = new Y.Doc()
    const ours = Y.encodeStateAsUpdate(doc)
    Y.applyUpdate(theirs, ours)
    const before = Y.encodeStateVector(theirs)
    const paragraph = theirs.getXmlFragment('default').get(0) as Y.XmlElement
    const words = paragraph.get(0) as Y.XmlText
    words.insert(5, ' world')
    const position = Y.createRelativePositionFromTypeIndex(words, 8)
    const within = Y.relativePositionToJSON(position)
    const ahead = { anchor: within, head: within }

    await peerSays({ user, cursor: caretAt(editor, 3) })
    const placed = caretAfter(editor)
    await peerSays({ user, cursor: ahead })
    const waiting = caretAfter(editor)
    const theirEdit = Y.encodeStateAsUpdate(theirs, before)
    Y.applyUpdate(doc, theirEdit)
    const arrived = caretAfter(editor)
    await peerSays({ user, cursor: null })
    const cleared = caretAfter(editor)
    await peerSays({ user, cursor: caretAt(editor, 3) })
    await peerSays(null)

    expect([placed, waiting, arrived, cleared]).toEqual(['he', 'he', 'hello wo', null])
    expect(caretAfter(editor)).toBeNull()
  })

  it('shades what another person selected in their colour, and nothing for a caret alone', async () => {
    searchUsers.mockResolvedValue([])
    const { editor, awareness } = open()
    const peerSays = peer(awareness)
    const user = { id: 'bea@x.com', color: '#3E63DD' }

    peerSays({ user, cursor: caretAt(editor, 2, 5) })
    await tick()
    const selected = shades(editor)
    peerSays({ user, cursor: caretAt(editor, 3) })
    await tick()

    expect(selected).toEqual([['ell', 'rgba(62, 99, 221, 0.2)']])
    expect(shades(editor)).toEqual([])
  })

  it('fades a name a few seconds after its person stops, and shows it again when they move', async () => {
    vi.useFakeTimers()
    searchUsers.mockResolvedValue([])
    const { editor, awareness } = open()
    const peerSays = peer(awareness)
    const user = { id: 'bea@x.com', color: '#3E63DD' }

    peerSays({ user, cursor: caretAt(editor, 3) })
    await vi.advanceTimersByTimeAsync(2000)
    const typing = idle(editor)
    await vi.advanceTimersByTimeAsync(1500)
    const still = idle(editor)
    peerSays({ user, cursor: caretAt(editor, 4) })
    await vi.advanceTimersByTimeAsync(0)

    expect([typing, still, idle(editor)]).toEqual([false, true, false])
  })

  it('lists each signed-in person once and every guest tab apart', () => {
    searchUsers.mockResolvedValue([])
    const color = '#E5484D'

    const peers: Peer[] = [
      { pid: PEER, user: 'cy@x.com', color },
      { pid: PEER + 1, user: 'cy@x.com', color },
      { pid: 2 ** 31 + 1_000_000, user: 'Guest', color },
      { pid: 2 ** 31 + 2_000_000, user: 'Guest', color },
    ]

    const people = peopleOf(peers)

    expect(people.map((person) => person.id)).toEqual(['cy@x.com', 'Guest', 'Guest'])
    expect(people[1].name).toMatch(/^Guest [0-9A-Z]{4}$/)
    expect(people[1].name).not.toBe(people[2].name)
  })
})
