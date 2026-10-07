import { Editor } from '@tiptap/core'
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
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

function open() {
  const scratch = new Y.Doc()
  scratch.clientID = 0
  const awareness = new Awareness(scratch)
  const presence = { awareness, peers: [], onChange: () => () => true }
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: new Y.Doc() }),
      Carets.configure({ presence }),
    ],
  })
  editors.push(editor)
  editor.commands.insertContent('hello')
  return { editor, awareness }
}

function caretAt(editor: Editor, at: number) {
  const { type, binding } = ySyncPluginKey.getState(editor.state)
  const position = absolutePositionToRelativePosition(at, type, binding.mapping)
  return { anchor: position, head: position }
}

function peer(awareness: Awareness) {
  const doc = new Y.Doc()
  doc.clientID = PEER
  const own = new Awareness(doc)
  return (state: object) => {
    own.setLocalState(state)
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(own, [PEER]), 'remote')
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

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
    searchUsers.mockReturnValue(new Promise((resolve) => (answer = resolve)))

    peerSays({ user: { id: 'bea@x.com', color: '#3E63DD' }, cursor: caretAt(editor, 3) })
    await tick()
    const before = labels(editor)
    answer([{ name: 'bea@x.com', full_name: 'Bea Writer' }])
    await tick()

    expect(awareness.getLocalState()?.cursor).toHaveProperty('head')
    expect(before).toEqual(['bea@x.com'])
    expect(labels(editor)).toEqual(['Bea Writer'])
  })

  it('lists each signed-in person once and every guest tab apart', () => {
    searchUsers.mockResolvedValue([])
    const color = '#E5484D'

    const people = peopleOf([
      { pid: PEER, user: 'cy@x.com', color },
      { pid: PEER + 1, user: 'cy@x.com', color },
      { pid: 2 ** 31 + 1_000_000, user: 'Guest', color },
      { pid: 2 ** 31 + 2_000_000, user: 'Guest', color },
    ])

    expect(people.map((person) => person.id)).toEqual(['cy@x.com', 'Guest', 'Guest'])
    expect(people[1].name).toMatch(/^Guest [0-9A-Z]{4}$/)
    expect(people[1].name).not.toBe(people[2].name)
  })
})
