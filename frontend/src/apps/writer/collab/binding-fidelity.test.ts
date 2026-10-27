import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it, vi } from 'vitest'

import {
  blocks,
  deliver,
  inside,
  openTabs,
  sendRow,
  stored,
  syncAll,
  type Tab,
} from '@/apps/writer/collab/test-support'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

// One tab restructures while the other adds something: the addition ends up once,
// or is reported, never silently lost or doubled. The binding drives every case

interface Token {
  kind: 'text' | 'image' | 'mention'
  key: string
}

const PARAGRAPHS = '<p>abc</p><p>defgh</p><p>xyz</p>'
const TASKS =
  '<ul data-type="taskList">' +
  ['abc', 'defgh', 'xyz']
    .map((word) => `<li data-type="taskItem" data-checked="false"><p>${word}</p></li>`)
    .join('') +
  '</ul>'
const TABLE =
  '<table><tr><td><p>abc</p></td><td><p>defgh</p></td></tr><tr><td><p>xyz</p></td><td><p>uvw</p></td></tr></table>'

function at(tab: Tab, offset = 1) {
  return tab.editor.chain().setTextSelection(inside(tab, 'defgh', offset))
}

function moveBlockAfterNext(editor: Editor, position: number) {
  const resolved = editor.state.doc.resolve(position)
  const from = resolved.before(resolved.depth)
  const block = resolved.parent
  const to = from + block.nodeSize
  const next = editor.state.doc.nodeAt(to)
  if (!next) {
    return
  }

  const transaction = editor.state.tr.delete(from, to)
  transaction.insert(from + next.nodeSize, block)
  editor.view.dispatch(transaction)
}

function cellBefore(tab: Tab, word: string) {
  const resolved = tab.editor.state.doc.resolve(inside(tab, word))
  return resolved.before(resolved.depth - 1)
}

function mergeFirstRow(tab: Tab) {
  const anchorCell = cellBefore(tab, 'abc')
  const headCell = cellBefore(tab, 'defgh')
  tab.editor.chain().setCellSelection({ anchorCell, headCell }).mergeCells().run()
}

function deleteParagraph(tab: Tab) {
  const position = inside(tab, 'defgh', 0)
  tab.editor.commands.deleteRange({ from: position - 1, to: position + 6 })
}

const RESTRUCTURES: Record<string, (tab: Tab) => void> = {
  join: (tab) => at(tab, 0).joinBackward().run(),
  heading: (tab) => at(tab).setNode('heading', { level: 2 }).run(),
  codeBlock: (tab) => at(tab).setNode('codeBlock').run(),
  wrapList: (tab) => at(tab).toggleBulletList().run(),
  wrapTask: (tab) => at(tab).toggleTaskList().run(),
  wrapQuote: (tab) => at(tab).toggleBlockquote().run(),
  split: (tab) => at(tab, 4).splitBlock().run(),
  deleteParagraph,
  blockMove: (tab) => moveBlockAfterNext(tab.editor, inside(tab, 'defgh')),
}

const ADDITIONS: Record<string, (tab: Tab) => Token> = {
  text: (tab) => typeIn(tab, 'QQ'),
  image: (tab) => {
    at(tab, 2)
      .insertContent({ type: 'image', attrs: { src: '/files/QQ.png', width: 10, height: 10 } })
      .run()
    return { kind: 'image', key: '/files/QQ.png' }
  },
  mention: (tab) => {
    at(tab, 2)
      .insertContent({ type: 'mention', attrs: { id: 'qq@x.com', label: 'QQ' } })
      .run()
    return { kind: 'mention', key: 'qq@x.com' }
  },
}

function typeIn(tab: Tab, key: string, word = 'defgh', offset = 2): Token {
  tab.editor
    .chain()
    .setTextSelection(inside(tab, word, offset))
    .insertContent(key)
    .run()
  return { kind: 'text', key }
}

interface Scenario {
  base: string
  restructure: (tab: Tab) => void
  add: (tab: Tab) => Token
}

const SCENARIOS: Record<string, Scenario> = {}
for (const [name, restructure] of Object.entries(RESTRUCTURES)) {
  SCENARIOS[`text/${name}`] = { base: PARAGRAPHS, restructure, add: ADDITIONS.text }
  if (['join', 'heading', 'wrapList', 'deleteParagraph', 'blockMove'].includes(name)) {
    SCENARIOS[`image/${name}`] = { base: PARAGRAPHS, restructure, add: ADDITIONS.image }
    SCENARIOS[`mention/${name}`] = { base: PARAGRAPHS, restructure, add: ADDITIONS.mention }
  }
}

Object.assign(SCENARIOS, {
  'text/inlineDelete': {
    base: '<p>left<br>defgh</p>',
    restructure: (tab: Tab) => {
      const position = inside(tab, 'defgh', 0)
      tab.editor.commands.deleteRange({ from: position - 1, to: position })
    },
    add: ADDITIONS.text,
  },
  'text/hardBreakSplit': {
    base: '<p>abc defgh</p>',
    restructure: (tab: Tab) => at(tab).setHardBreak().run(),
    add: (tab: Tab) => typeIn(tab, 'QQ', 'defgh', 3),
  },
  'text/joinRepeated': {
    base: '<p>abc</p><p>defgh</p><p>defgh</p>',
    restructure: RESTRUCTURES.join,
    add: ADDITIONS.text,
  },
  'task/lift': {
    base: TASKS,
    restructure: (tab: Tab) => at(tab).liftListItem('taskItem').run(),
    add: ADDITIONS.text,
  },
  'task/sink': {
    base: TASKS,
    restructure: (tab: Tab) => at(tab).sinkListItem('taskItem').run(),
    add: ADDITIONS.text,
  },
  'task/unwrap': { base: TASKS, restructure: RESTRUCTURES.wrapTask, add: ADDITIONS.text },
  'task/join': { base: TASKS, restructure: RESTRUCTURES.join, add: ADDITIONS.text },
  'table/headerRow': {
    base: TABLE,
    restructure: (tab: Tab) => at(tab).toggleHeaderRow().run(),
    add: ADDITIONS.text,
  },
  'table/headerCell': {
    base: TABLE,
    restructure: (tab: Tab) => at(tab).toggleHeaderCell().run(),
    add: ADDITIONS.text,
  },
  'table/addColumnBefore': {
    base: TABLE,
    restructure: (tab: Tab) => at(tab).addColumnBefore().run(),
    add: ADDITIONS.text,
  },
  'table/addRowBefore': {
    base: TABLE,
    restructure: (tab: Tab) => at(tab).addRowBefore().run(),
    add: ADDITIONS.text,
  },
  'table/deleteRow': {
    base: TABLE,
    restructure: (tab: Tab) => at(tab).deleteRow().run(),
    add: ADDITIONS.text,
  },
  'table/mergeCells': { base: TABLE, restructure: mergeFirstRow, add: ADDITIONS.text },
})

async function tabsHolding(html: string) {
  const tabs = await openTabs(stored({ type: 'paragraph' }), 2)
  tabs[0].editor.commands.setContent(html)
  await syncAll(tabs)
  return tabs
}

function copiesOf(doc: PMNode, token: Token) {
  let copies = 0
  doc.descendants((node) => {
    if (token.kind === 'text' && node.isText) {
      copies += node.text!.split(token.key).length - 1
    }

    const keyAttr = token.kind === 'image' ? 'src' : 'id'
    if (node.type.name === token.kind && node.attrs[keyAttr] === token.key) {
      copies++
    }
  })
  return copies
}

function isReported(tab: Tab, token: Token) {
  return tab.reported.some((removal) => {
    if (removal.kind === 'node') {
      const keyAttr = token.kind === 'image' ? 'src' : 'id'
      return removal.name === token.kind && removal.attrs[keyAttr] === token.key
    }

    return token.kind === 'text' && removal.runs.some((run) => run.text.includes(token.key))
  })
}

// Once in the document, or gone and reported by the tab that added it
function fate(adder: Tab, token: Token) {
  const copies = copiesOf(adder.editor.state.doc, token)
  if (copies === 0) {
    return isReported(adder, token) ? 'reported' : 'lost'
  }

  return copies === 1 ? 'once' : 'doubled'
}

describe('binding fidelity: one tab restructures while the other adds', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    // Both client orders: the restructuring tab is the lower id, then the higher
    it.each([0, 1])(`${name} (restructuring tab %i)`, async (restructuring) => {
      const tabs = await tabsHolding(scenario.base)
      const restructurer = tabs[restructuring]
      const adder = tabs[1 - restructuring]
      scenario.restructure(restructurer)
      const token = scenario.add(adder)

      await deliver(tabs, [
        [restructurer, sendRow(restructurer)],
        [adder, sendRow(adder)],
      ])
      await syncAll(tabs)

      expect(blocks(restructurer)).toEqual(blocks(adder))
      expect(['once', 'reported']).toContain(fate(adder, token))
    })
  }
})

const WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
  'kilo',
  'lima',
]
const TRIALS = Number(process.env.WRITER_RACE_TRIALS ?? 2)

function textblocks(editor: Editor) {
  const found: { position: number; node: PMNode }[] = []
  editor.state.doc.descendants((node, position) => {
    if (!node.isTextblock) {
      return true
    }

    found.push({ position, node })
    return false
  })
  return found
}

function randomRestructure(tab: Tab, pick: (count: number) => number) {
  const all = textblocks(tab.editor)
  const { position, node } = all[pick(all.length)]
  const chain = tab.editor.chain().setTextSelection(position + 1)
  const isHeading = node.type.name === 'heading'
  const restructures = [
    () => chain.setNode(isHeading ? 'paragraph' : 'heading', { level: 2 }).run(),
    () => chain.joinBackward().run(),
    () => chain.toggleBulletList().run(),
    () => chain.toggleTaskList().run(),
    () => chain.toggleBlockquote().run(),
    () => moveBlockAfterNext(tab.editor, position + 1),
  ]
  restructures[pick(restructures.length)]()
}

// A place in a random block that doesn't split an earlier token
function randomType(tab: Tab, pick: (count: number) => number, key: string): Token {
  const all = textblocks(tab.editor)
  const { position, node } = all[pick(all.length)]
  const content = node.textContent
  const offsets = [...Array(content.length + 1).keys()].filter((offset) => {
    const before = content.slice(0, offset)
    return before.split('<').length === before.split('>').length
  })
  const offset = offsets[pick(offsets.length)]
  tab.editor
    .chain()
    .setTextSelection(position + 1 + offset)
    .insertContent(key)
    .run()
  return { kind: 'text', key }
}

function seeded(seed: number) {
  let state = seed
  return (count: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return Math.floor((state / 0x7fffffff) * count) % count
  }
}

describe('binding fidelity: random restructures against typing', () => {
  it.each([...Array(TRIALS).keys()])('trial %i', async (trial) => {
    const pick = seeded(1000 + trial)
    const base = WORDS.map((word) => `<p>${word} sentence ${word}</p>`).join('')
    const tabs = await tabsHolding(base)
    const [restructurer, typist] = tabs
    for (let round = 0; round < 6; round++) {
      randomRestructure(restructurer, pick)
      randomRestructure(restructurer, pick)
      const tokens = [0, 1, 2, 3].map((index) => randomType(typist, pick, `<${round}.${index}>`))

      await deliver(tabs, [
        [restructurer, sendRow(restructurer)],
        [typist, sendRow(typist)],
      ])
      await syncAll(tabs)

      expect(blocks(restructurer)).toEqual(blocks(typist))
      for (const token of tokens) {
        expect([token.key, fate(typist, token)]).toEqual([
          token.key,
          expect.stringMatching(/^(once|reported)$/),
        ])
      }
    }

    const text = blocks(typist)
      .join(' ')
      .replace(/<\d+\.\d+>/g, '')
    expect(text.split('sentence')).toHaveLength(WORDS.length + 1)
  })
})
