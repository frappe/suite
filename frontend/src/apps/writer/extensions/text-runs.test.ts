import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
  yUndoPluginKey,
} from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import { BODY_FIELD } from '../collab/field'
import { writerEditorExtensions } from '../editor-extensions'
import { getEditorPos } from './comments'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

const REMOTE = 'remote'

interface Tab {
  ydoc: Y.Doc
  editor: Editor
}

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function element(name: string, ...children: (Y.XmlElement | Y.XmlText)[]) {
  const node = new Y.XmlElement(name)
  node.insert(0, children)
  return node
}

function texts(...strings: string[]) {
  return element('paragraph', ...strings.map((text) => new Y.XmlText(text)))
}

function stored(...blocks: Y.XmlElement[]) {
  const doc = new Y.Doc()
  doc.getXmlFragment(BODY_FIELD).insert(0, blocks)
  return Y.encodeStateAsUpdate(doc)
}

function open(state: Uint8Array): Tab {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state, REMOTE)
  const extensions = writerEditorExtensions({
    collaborative: true,
    mentionItems: () => [],
    onMentionQuery: () => {},
    onCommentActivated: () => {},
    onAnchors: () => {},
    scrollParent: () => window,
    media: null,
    comments: ydoc.getMap('comments'),
    ydoc,
    activeComment: ref(null),
    showComments: ref(false),
    showResolved: ref(false),
    edited: ref(false),
    onCommentsPainted: () => {},
  })
  const collaboration = Collaboration.configure({ document: ydoc, field: BODY_FIELD })
  const mount = document.createElement('div')
  document.body.append(mount)
  const editor = new Editor({ element: mount, extensions: [...extensions, collaboration] })
  editors.push(editor)
  return { ydoc, editor }
}

function exchange(...tabs: Tab[]) {
  for (const target of tabs) {
    for (const source of tabs) {
      const missing = Y.encodeStateAsUpdate(source.ydoc, Y.encodeStateVector(target.ydoc))
      Y.applyUpdate(target.ydoc, missing, REMOTE)
    }
  }
}

function block(tab: Tab, index = 0) {
  return tab.ydoc.getXmlFragment(BODY_FIELD).get(index) as Y.XmlElement
}

// What each Yjs text in the block holds
function pieces(tab: Tab, index = 0) {
  return block(tab, index)
    .toArray()
    .map((text) => (text as Y.XmlText).toString())
}

function ownClock(tab: Tab) {
  return Y.getState(tab.ydoc.store, tab.ydoc.clientID)
}

function type(tab: Tab, text: string, at: number) {
  tab.editor.view.dispatch(tab.editor.state.tr.insertText(text, at))
}

function typeAtOnce() {
  const base = stored(element('paragraph'))
  const tabs = [open(base), open(base)]
  type(tabs[0], 'a', 1)
  type(tabs[1], 'b', 1)
  exchange(...tabs)
  return tabs
}

describe('neighbouring texts in one block', () => {
  it('show as one run of text and open without a write', () => {
    const tab = open(stored(texts('ab', 'cd', 'ef')))

    expect(tab.editor.state.doc.textContent).toBe('abcdef')
    expect([pieces(tab), ownClock(tab)]).toEqual([['ab', 'cd', 'ef'], 0])
  })

  it('take typing into the text that holds it and keep the others apart', () => {
    const tab = open(stored(texts('ab', 'cd', 'ef')))

    type(tab, 'X', 4)

    expect(pieces(tab)).toEqual(['ab', 'cXd', 'ef'])
  })

  it('stay apart once two tabs that typed into one empty block at once sync', () => {
    const [mine, other] = typeAtOnce()
    exchange(mine, other)

    expect([pieces(mine).length, pieces(other).length]).toEqual([2, 2])
    expect(mine.editor.state.doc.textContent).toBe(other.editor.state.doc.textContent)
  })

  it('write nothing when a render meets empty texts among them', () => {
    const tab = open(stored(texts('a', '', 'b'), texts('', ''), texts('c')))
    const before = tab.ydoc.getXmlFragment(BODY_FIELD).toString()
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(tab.ydoc))
    remote.getXmlFragment(BODY_FIELD).insert(3, [texts('d')])

    Y.applyUpdate(tab.ydoc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(tab.ydoc)), REMOTE)

    expect(ownClock(tab)).toBe(0)
    expect(tab.ydoc.getXmlFragment(BODY_FIELD).toString()).toBe(`${before}<paragraph>d</paragraph>`)
  })

  it('write only the keystroke when typing beside them', () => {
    const tab = open(stored(texts('a', '', 'b'), texts('', ''), texts('c')))

    type(tab, 'X', tab.editor.state.doc.content.size - 1)

    expect(ownClock(tab)).toBe(1)
    expect([pieces(tab, 0), pieces(tab, 1), pieces(tab, 2)]).toEqual([
      ['a', '', 'b'],
      ['', ''],
      ['cX'],
    ])
  })
})

describe('marks across neighbouring texts', () => {
  it('stay on the text that holds them when the text beside it is typed into', () => {
    const doc = new Y.Doc()
    const [plain, kept] = [new Y.XmlText('ab'), new Y.XmlText('cd')]
    doc.getXmlFragment(BODY_FIELD).insert(0, [element('paragraph', plain, kept)])
    kept.format(0, 2, { mystery: { tone: 'warm' } })
    const tab = open(Y.encodeStateAsUpdate(doc))

    type(tab, 'X', 2)

    const [left, right] = block(tab).toArray() as Y.XmlText[]
    expect(left.toDelta()).toEqual([{ insert: 'aXb' }])
    expect(right.toDelta()).toEqual([{ insert: 'cd', attributes: { mystery: { tone: 'warm' } } }])
  })

  it('go onto every text a mark is set across, each keeping its own', () => {
    const doc = new Y.Doc()
    const [plain, kept] = [new Y.XmlText('ab'), new Y.XmlText('cd')]
    doc.getXmlFragment(BODY_FIELD).insert(0, [element('paragraph', plain, kept)])
    kept.format(0, 2, { mystery: { tone: 'warm' } })
    const tab = open(Y.encodeStateAsUpdate(doc))

    tab.editor.chain().setTextSelection({ from: 2, to: 4 }).setBold().run()

    const [left, right] = block(tab).toArray() as Y.XmlText[]
    expect(left.toDelta()).toEqual([{ insert: 'a' }, { insert: 'b', attributes: { bold: {} } }])
    expect(right.toDelta()).toEqual([
      { insert: 'c', attributes: { bold: {}, mystery: { tone: 'warm' } } },
      { insert: 'd', attributes: { mystery: { tone: 'warm' } } },
    ])
  })
})

describe('typing where two texts meet', () => {
  it('lands in the text before the boundary', () => {
    const tab = open(stored(texts('ab', 'cd')))

    type(tab, 'X', 3)

    expect(pieces(tab)).toEqual(['abX', 'cd'])
  })

  it('lands in an empty text before the boundary', () => {
    const tab = open(stored(texts('', 'cd')))

    type(tab, 'X', 1)

    expect(pieces(tab)).toEqual(['X', 'cd'])
  })

  it('survives another tab clearing the text before it', () => {
    const base = stored(texts('ab', 'cd'))
    const [clearing, typing] = [open(base), open(base)]

    clearing.editor.commands.deleteRange({ from: 1, to: 3 })
    type(typing, 'X', 3)
    exchange(clearing, typing)
    exchange(clearing, typing)

    expect([clearing, typing].map((tab) => tab.editor.state.doc.textContent)).toEqual([
      'Xcd',
      'Xcd',
    ])
  })

  it('survives another tab clearing the whole block', () => {
    const base = stored(texts('ab', 'cd'), texts('end'))
    const [clearing, typing] = [open(base), open(base)]

    clearing.editor.commands.deleteRange({ from: 1, to: 5 })
    type(typing, 'X', 4)
    exchange(clearing, typing)
    exchange(clearing, typing)

    expect([clearing, typing].map((tab) => tab.editor.state.doc.textContent)).toEqual([
      'Xend',
      'Xend',
    ])
  })
})

describe('undo over neighbouring texts', () => {
  it('converges without doubling after undo and redo in one tab', () => {
    const [mine, other] = typeAtOnce()
    exchange(mine, other)
    yUndoPluginKey.getState(mine.editor.state).undoManager.stopCapturing()
    type(mine, 'X', 3)
    type(other, 'Y', 1)
    exchange(mine, other)

    mine.editor.commands.undo()
    exchange(mine, other)
    const undone = [mine, other].map((tab) => tab.editor.state.doc.textContent)
    mine.editor.commands.redo()
    exchange(mine, other)
    exchange(mine, other)

    const redone = [mine, other].map((tab) => tab.editor.state.doc.textContent)
    expect(undone[0]).toBe(undone[1])
    expect([...undone[0]].sort()).toEqual(['Y', 'a', 'b'])
    expect(redone[0]).toBe(redone[1])
    expect([...redone[0]].sort()).toEqual(['X', 'Y', 'a', 'b'])
  })
})

describe('positions in neighbouring texts', () => {
  function resolve(tab: Tab, relative: Y.RelativePosition) {
    const { type: root, binding } = ySyncPluginKey.getState(tab.editor.state)
    return relativePositionToAbsolutePosition(
      tab.ydoc,
      root,
      relative,
      binding.mapping,
      binding.hidden,
    )
  }

  function roundTrips(tab: Tab) {
    const { type: root, binding } = ySyncPluginKey.getState(tab.editor.state)
    const positions = []
    for (let pos = 0; pos <= tab.editor.state.doc.content.size; pos++) {
      const relative = absolutePositionToRelativePosition(
        pos,
        root,
        binding.mapping,
        binding.hidden,
      )
      positions.push(resolve(tab, relative))
    }

    return positions
  }

  it('map every position there and back as one text does', () => {
    const one = open(stored(texts('abcdef')))
    const three = open(stored(texts('ab', 'cd', 'ef')))

    expect(roundTrips(three)).toEqual(roundTrips(one))
  })

  it('place a caret in the second and third texts, and follow an edit before it', () => {
    const tab = open(stored(texts('ab', 'cd', 'ef')))
    const [, second, third] = block(tab).toArray() as Y.XmlText[]
    const carets = [
      Y.createRelativePositionFromTypeIndex(second, 1),
      Y.createRelativePositionFromTypeIndex(third, 1),
    ]

    const before = carets.map((caret) => resolve(tab, caret))
    type(tab, 'X', 1)
    const after = carets.map((caret) => resolve(tab, caret))

    expect([before, after]).toEqual([
      [4, 6],
      [5, 7],
    ])
  })

  it('highlight a comment made across the second and third texts', () => {
    const tab = open(stored(texts('ab', 'cd', 'ef')))
    const [, second, third] = block(tab).toArray() as Y.XmlText[]
    const [from, to] = [
      Y.createRelativePositionFromTypeIndex(second, 1),
      Y.createRelativePositionFromTypeIndex(third, 1),
    ].map((position) => Y.encodeRelativePosition(position))

    tab.ydoc.getMap('comments').set('c1', { id: 'c1', anchor: { from, to }, resolved: false })

    const highlight = tab.editor.view.dom.querySelectorAll('[data-comment-name="c1"]')
    expect([...highlight].map((mark) => mark.textContent).join('')).toBe('de')
    expect(getEditorPos(from, tab.editor)).toBe(4)
  })
})

describe('typing cost over neighbouring texts', () => {
  // Keystrokes alternate between the two, so load from other test files slows both alike
  function typingTimes(whole: Tab, split: Tab, at: (tab: Tab) => number) {
    const times: [number[], number[]] = [[], []]
    for (let i = 0; i < 31; i++) {
      for (const [which, tab] of [whole, split].entries()) {
        const started = performance.now()
        tab.editor.view.dispatch(tab.editor.state.tr.insertText('x', at(tab)))
        times[which].push(performance.now() - started)
      }
    }

    return times.map((each) => {
      const sorted = each.sort((left, right) => left - right)
      return sorted[15]
    })
  }

  function middle(tab: Tab) {
    return tab.editor.state.doc.resolve(Math.floor(tab.editor.state.doc.content.size / 2)).start()
  }

  it('takes at most twice as long per keystroke over 2,000 split paragraphs as over whole ones', () => {
    const words = Array.from({ length: 2000 }, (_, i) => [`paragraph `, `${i}`])
    const whole = open(stored(...words.map((parts) => texts(parts.join('')))))
    const split = open(stored(...words.map((parts) => texts(...parts))))
    typingTimes(whole, split, middle)

    const [wholeTime, splitTime] = typingTimes(whole, split, middle)

    expect(splitTime).toBeLessThanOrEqual(2 * wholeTime)
  })

  it('takes at most twice as long per keystroke in a paragraph of 200 texts as in one text', () => {
    const parts = Array.from({ length: 200 }, (_, i) => `part ${i} `)
    const whole = open(stored(texts(parts.join(''))))
    const split = open(stored(texts(...parts)))
    typingTimes(whole, split, () => 500)

    const [wholeTime, splitTime] = typingTimes(whole, split, () => 500)

    expect(splitTime).toBeLessThanOrEqual(2 * wholeTime)
  })
})

// A seeded generator, so a failing run repeats
function generator(seed: number) {
  let state = seed
  return (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state % below
  }
}

const SEED_TEXT = 'ABCDEFGH'

function fuzzBase(isSplit: boolean) {
  if (isSplit) {
    return stored(texts('ABC', 'DEF', 'GH'))
  }

  return stored(element('paragraph'))
}

// Odd seeds start from stored text split over three texts, even ones from an empty block every tab types into first
function fuzz(tabCount: number, isThroughServer: boolean, seed: number) {
  const random = generator(seed)
  const isSplit = seed % 2 === 1
  const base = fuzzBase(isSplit)
  const server = new Y.Doc()
  Y.applyUpdate(server, base)
  const tabs = Array.from({ length: tabCount }, () => open(base))
  const typed: string[] = []
  const deleted = new Set<string>()
  let next = 0x4e00

  function edit(tab: Tab) {
    const text = tab.editor.state.doc.textContent
    const survivors = [...text].filter((char) => SEED_TEXT.includes(char))
    if (random(3) === 0 && survivors.length > 0) {
      const char = survivors[random(survivors.length)]
      deleted.add(char)
      tab.editor.commands.deleteRange({ from: 1 + text.indexOf(char), to: 2 + text.indexOf(char) })
      return
    }

    const char = String.fromCharCode(next++)
    typed.push(char)
    type(tab, char, 1 + random(text.length + 1))
  }

  function sendThroughServer(tab: Tab) {
    Y.applyUpdate(server, Y.encodeStateAsUpdate(tab.ydoc, Y.encodeStateVector(server)), REMOTE)
    Y.applyUpdate(tab.ydoc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(tab.ydoc)), REMOTE)
  }

  function syncSome() {
    const [left, right] = [tabs[random(tabCount)], tabs[random(tabCount)]]
    if (isThroughServer) {
      sendThroughServer(left)
      return
    }

    exchange(left, right)
  }

  function syncAll() {
    if (!isThroughServer) {
      exchange(...tabs)
      return
    }

    for (const tab of tabs) {
      sendThroughServer(tab)
    }
  }

  if (!isSplit) {
    for (const tab of tabs) {
      edit(tab)
    }
  }

  for (let step = 0; step < 40; step++) {
    edit(tabs[random(tabCount)])
    if (random(2) === 0) {
      syncSome()
    }
  }

  for (let round = 0; round < 3; round++) {
    syncAll()
  }

  const expected = [...typed]
  if (isSplit) {
    expected.push(...[...SEED_TEXT].filter((char) => !deleted.has(char)))
  }

  expected.sort()
  return { shown: tabs.map((tab) => tab.editor.state.doc.textContent), expected }
}

describe('many tabs typing into one block at once', () => {
  for (const tabCount of [3, 4, 5]) {
    for (const [isThroughServer, route] of [
      [false, 'pairwise'],
      [true, 'through a server'],
    ] as const) {
      it(`keeps every character with ${tabCount} tabs ${route}`, () => {
        for (let seed = 1; seed <= 15; seed++) {
          const { shown, expected } = fuzz(tabCount, isThroughServer, seed)
          expect(new Set(shown).size, `seed ${seed}`).toBe(1)
          expect([...shown[0]].sort(), `seed ${seed}`).toEqual(expected)
          for (const editor of editors.splice(0)) {
            editor.destroy()
          }
        }
      })
    }
  }
})
