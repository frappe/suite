import { describe, expect, it, vi } from 'vitest'

import {
  allReported,
  makeHeading,
  paragraph,
  sendInOrder,
  text,
  typeAt,
} from '@/apps/writer/collab/removal-fixtures'
import { blocks, inside, openTabs, stored, type Tab } from '@/apps/writer/collab/test-support'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

// The editor adds an empty paragraph after a last block that stops being one, in the same step
describe('text typed into a block as another tab restructures it (R291)', () => {
  const abcAtEnd = stored(paragraph(text('one')), paragraph(text('abc')))

  const orders = [
    {
      name: 'A is tab 1, A sends first',
      isRestructurerFirstTab: true,
      isRestructurerSendingFirst: true,
    },
    {
      name: 'A is tab 1, B sends first',
      isRestructurerFirstTab: true,
      isRestructurerSendingFirst: false,
    },
    {
      name: 'A is tab 2, A sends first',
      isRestructurerFirstTab: false,
      isRestructurerSendingFirst: true,
    },
    {
      name: 'A is tab 2, B sends first',
      isRestructurerFirstTab: false,
      isRestructurerSendingFirst: false,
    },
  ]

  type Order = (typeof orders)[number]

  function typeWithRule(tab: Tab, word: string, marker: string) {
    tab.editor
      .chain()
      .setTextSelection(inside(tab, word, 0))
      .insertContent(marker)
      .run()
    const { view } = tab.editor
    const { from, to } = view.state.selection
    view.someProp('handleTextInput', (handle) =>
      handle(view, from, to, ' ', () => view.state.tr.insertText(' ', from, to)),
    )
  }

  function lostX(seen: string, offset: number) {
    return {
      kind: 'text',
      seen,
      runs: [{ offset, text: 'X', attrs: {} }],
      written: expect.anything(),
      pulled: expect.anything(),
      isUncertain: false,
    }
  }

  function topTypes(tab: Tab) {
    return tab.editor.getJSON().content!.map((node) => node.type)
  }

  // A restructures a block while B types in it, by default X between b and c of the last block "abc"
  async function restructureWhileTyping(
    order: Order,
    restructure: (tab: Tab) => void,
    state = abcAtEnd,
    typeInBlock = (tab: Tab) => typeAt(tab, 'abc', 2, 'X'),
  ) {
    const tabs = await openTabs(state, 2)
    const [first, second] = tabs
    const restructuring = order.isRestructurerFirstTab ? first : second
    const typing = order.isRestructurerFirstTab ? second : first
    restructure(restructuring)
    typeInBlock(typing)

    const senders = [restructuring, typing]
    if (!order.isRestructurerSendingFirst) {
      senders.reverse()
    }

    await sendInOrder(tabs, senders)
    return tabs
  }

  function lastBlockAt(tab: Tab, offset: number) {
    const { doc } = tab.editor.state
    return doc.content.size - doc.lastChild!.nodeSize + 1 + offset
  }

  it.each(orders)('types it back into the heading made with the menu ($name)', async (order) => {
    const tabs = await restructureWhileTyping(order, (tab) => makeHeading(tab, 'abc'))

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual(['paragraph one', 'heading abXc', 'paragraph '])
    }

    expect(allReported(tabs)).toEqual([])
  })

  // The rule's row wrote the marker and removed it with the block, so the copy lacks what the typing tab saw
  it.each(orders)('reports it when the heading was made by typing ## ($name)', async (order) => {
    const tabs = await restructureWhileTyping(order, (tab) => typeWithRule(tab, 'abc', '##'))

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual(['paragraph one', 'heading abc', 'paragraph '])
    }

    expect(allReported(tabs)).toEqual([lostX('##abc', 4)])
  })

  it.each(orders)('types it back into the list made with the menu ($name)', async (order) => {
    const tabs = await restructureWhileTyping(order, (tab) =>
      tab.editor.chain().setTextSelection(inside(tab, 'abc')).toggleBulletList().run(),
    )

    for (const tab of tabs) {
      expect(topTypes(tab)).toEqual(['paragraph', 'bulletList', 'paragraph'])
      expect(blocks(tab)).toEqual(['paragraph one', 'paragraph abXc', 'paragraph '])
    }

    expect(allReported(tabs)).toEqual([])
  })

  it.each(orders)('reports it when the list was made by typing - ($name)', async (order) => {
    const tabs = await restructureWhileTyping(order, (tab) => typeWithRule(tab, 'abc', '-'))

    for (const tab of tabs) {
      expect(topTypes(tab)).toEqual(['paragraph', 'bulletList', 'paragraph'])
      expect(blocks(tab)).toEqual(['paragraph one', 'paragraph abc', 'paragraph '])
    }

    expect(allReported(tabs)).toEqual([lostX('-abc', 3)])
  })

  it.each(orders)(
    'keeps it in the empty last paragraph a table went into ($name)',
    async (order) => {
      const emptyAtEnd = stored(paragraph(text('one')), { type: 'paragraph' })
      const tabs = await restructureWhileTyping(
        order,
        (tab) =>
          tab.editor
            .chain()
            .setTextSelection(lastBlockAt(tab, 0))
            .insertTable({ rows: 1, cols: 1, withHeaderRow: false })
            .run(),
        emptyAtEnd,
        (tab) => tab.editor.chain().setTextSelection(lastBlockAt(tab, 0)).insertContent('X').run(),
      )

      for (const tab of tabs) {
        expect(topTypes(tab)).toEqual(['paragraph', 'table', 'paragraph'])
        expect(blocks(tab).at(-1)).toEqual('paragraph X')
      }

      expect(allReported(tabs)).toEqual([])
    },
  )

  it.each(orders)(
    'types it back into the heading made in the step that adds an empty paragraph above ($name)',
    async (order) => {
      const abcFirst = stored(paragraph(text('abc')), paragraph(text('xyz')))
      const tabs = await restructureWhileTyping(
        order,
        (tab) =>
          tab.editor
            .chain()
            .setTextSelection(inside(tab, 'abc'))
            .setNode('heading', { level: 2 })
            .insertContentAt(0, { type: 'paragraph' })
            .run(),
        abcFirst,
      )

      for (const tab of tabs) {
        expect(blocks(tab)).toEqual(['paragraph ', 'heading abXc', 'paragraph xyz'])
      }

      expect(allReported(tabs)).toEqual([])
    },
  )

  it.each(orders)(
    'keeps it in a short paragraph a table went in front of ($name)',
    async (order) => {
      const abAtEnd = stored(paragraph(text('one')), paragraph(text('ab')))
      const tabs = await restructureWhileTyping(
        order,
        (tab) =>
          tab.editor
            .chain()
            .setTextSelection(inside(tab, 'ab', 0))
            .insertTable({ rows: 1, cols: 1, withHeaderRow: false })
            .run(),
        abAtEnd,
        (tab) => typeAt(tab, 'ab', 1, 'X'),
      )

      for (const tab of tabs) {
        expect(topTypes(tab)).toEqual(['paragraph', 'table', 'paragraph'])
        expect(blocks(tab).at(-1)).toEqual('paragraph aXb')
      }

      expect(allReported(tabs)).toEqual([])
    },
  )

  // Pinned in R2 as 01.2 with QQ left on its own line after the heading
  it.each(orders)('types back a word typed at the end of the block ($name)', async (order) => {
    const limaAtEnd = stored(
      paragraph(text('alpha sentence alpha')),
      paragraph(text('lima sentence lima')),
    )
    const tabs = await restructureWhileTyping(
      order,
      (tab) => makeHeading(tab, 'lima'),
      limaAtEnd,
      (tab) => typeAt(tab, 'lima sentence lima', 18, 'QQ'),
    )

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual([
        'paragraph alpha sentence alpha',
        'heading lima sentence limaQQ',
        'paragraph ',
      ])
    }

    expect(allReported(tabs)).toEqual([])
  })

  it.each(orders)('keeps it in a block emptied and split in one step ($name)', async (order) => {
    const abcdLast = stored(paragraph(text('one')), paragraph(text('abcd')))
    const tabs = await restructureWhileTyping(
      order,
      (tab) =>
        tab.editor
          .chain()
          .setTextSelection({ from: inside(tab, 'abcd', 0), to: inside(tab, 'abcd', 4) })
          .splitBlock()
          .run(),
      abcdLast,
      (tab) => typeAt(tab, 'abcd', 2, 'XY'),
    )

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual(['paragraph one', 'paragraph XY', 'paragraph '])
    }

    expect(allReported(tabs)).toEqual([])
  })

  it.each(orders)(
    'keeps it in a block emptied in the step that edits the next one ($name)',
    async (order) => {
      const abcdMid = stored(
        paragraph(text('one')),
        paragraph(text('abcd')),
        paragraph(text('xyz')),
      )
      const tabs = await restructureWhileTyping(
        order,
        (tab) =>
          tab.editor
            .chain()
            .insertContentAt(inside(tab, 'xyz', 3), 'W')
            .deleteRange({ from: inside(tab, 'abcd', 0), to: inside(tab, 'abcd', 4) })
            .run(),
        abcdMid,
        (tab) => typeAt(tab, 'abcd', 2, 'XY'),
      )

      for (const tab of tabs) {
        expect(blocks(tab)).toEqual(['paragraph one', 'paragraph XY', 'paragraph xyzW'])
      }

      expect(allReported(tabs)).toEqual([])
    },
  )
})
