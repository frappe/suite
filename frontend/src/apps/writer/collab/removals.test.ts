import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import {
  allReported,
  lostQQ,
  makeHeading,
  paragraph,
  sendInOrder,
  text,
  threeParagraphs,
  typeAt,
  typeQQ,
} from '@/apps/writer/collab/removal-fixtures'
import { typeBack } from '@/apps/writer/collab/removals'
import {
  blocks,
  inside,
  openTabs,
  stored,
  syncAll,
  type Tab,
} from '@/apps/writer/collab/test-support'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

function joinUp(tab: Tab, word: string) {
  tab.editor
    .chain()
    .setTextSelection(inside(tab, word, 0))
    .joinBackward()
    .run()
}

function deleteBlock(tab: Tab, index: number) {
  const { doc } = tab.editor.state
  let from = 0
  for (let child = 0; child < index; child++) {
    from += doc.child(child).nodeSize
  }

  tab.editor.commands.deleteRange({ from, to: from + doc.child(index).nodeSize })
}

describe('text a row removed with the block around it', () => {
  it('types the joined text back when the other tab made the block a heading (R154.1)', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [headingTab, joinTab] = tabs
    makeHeading(headingTab, 'abc')
    joinUp(joinTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect(blocks(headingTab)).toEqual(['heading abcdefgh', 'paragraph xyz'])
    expect(blocks(joinTab)).toEqual(blocks(headingTab))
    expect(allReported(tabs)).toEqual([])
  })

  it('types text back once when the other tab made its block a heading (R154.2)', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [headingTab, typingTab] = tabs
    makeHeading(headingTab, 'defgh')
    typeQQ(typingTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect(blocks(headingTab)).toEqual(['paragraph abc', 'heading deQQfgh', 'paragraph xyz'])
    expect(blocks(typingTab)).toEqual(blocks(headingTab))
    expect(allReported(tabs)).toEqual([])
  })

  it('types back two tabs typing at different places when a third made the block a heading (R296)', async () => {
    const tabs = await openTabs(threeParagraphs, 3)
    const [headingTab, qqTab, rrTab] = tabs
    typeQQ(qqTab, 'defgh')
    typeAt(rrTab, 'defgh', 4, 'RR')
    makeHeading(headingTab, 'defgh')

    await sendInOrder(tabs, [qqTab, rrTab, headingTab])

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual(['paragraph abc', 'heading deQQfgRRh', 'paragraph xyz'])
    }

    expect(allReported(tabs)).toEqual([])
  })

  it('types back into the row copy, not an older block with the same text', async () => {
    const repeated = stored(
      paragraph(text('abc')),
      paragraph(text('defgh')),
      paragraph(text('defgh')),
    )
    const tabs = await openTabs(repeated, 2)
    const [joinTab, typingTab] = tabs
    joinUp(joinTab, 'defgh')
    typeQQ(typingTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect(blocks(joinTab)).toEqual(['paragraph abcdeQQfgh', 'paragraph defgh'])
    expect(blocks(typingTab)).toEqual(blocks(joinTab))
    expect(allReported(tabs)).toEqual([])
  })

  it('reports text the row copied to two places, and types neither back', async () => {
    const twice = stored(paragraph(text('defgh')), paragraph(text('defgh')), paragraph(text('xyz')))
    const tabs = await openTabs(twice, 2)
    const [headingTab, typingTab] = tabs
    const to = headingTab.editor.state.doc.child(0).nodeSize + 2
    headingTab.editor
      .chain()
      .setTextSelection({ from: 1, to })
      .setNode('heading', { level: 2 })
      .run()
    typeQQ(typingTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect(blocks(headingTab)).toEqual(['heading defgh', 'heading defgh', 'paragraph xyz'])
    expect(blocks(typingTab)).toEqual(blocks(headingTab))
    expect(typingTab.reported).toEqual([lostQQ])
    expect(headingTab.reported).toEqual([])
  })

  it('types back when the same row also typed in another block', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [headingTab, typingTab] = tabs
    makeHeading(headingTab, 'defgh')
    typeAt(headingTab, 'xyz', 3, 'more')
    typeQQ(typingTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect(blocks(headingTab)).toEqual(['paragraph abc', 'heading deQQfgh', 'paragraph xyzmore'])
    expect(blocks(typingTab)).toEqual(blocks(headingTab))
    expect(allReported(tabs)).toEqual([])
  })
})

// The row also typed inside the block it restructured, so no run it wrote equals `seen` there
describe('text the row could only type back in the wrong place (R278)', () => {
  it('reports when another run the row typed holds the text', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [headingTab, typingTab] = tabs
    makeHeading(headingTab, 'defgh')
    typeAt(headingTab, 'defgh', 2, 'X')
    typeAt(headingTab, 'xyz', 3, 'defghs')
    typeQQ(typingTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect(blocks(headingTab)).toEqual(['paragraph abc', 'heading deXfgh', 'paragraph xyzdefghs'])
    expect(blocks(typingTab)).toEqual(blocks(headingTab))
    expect(typingTab.reported).toEqual([lostQQ])
  })

  it('reports when the row typed the text in two places around older text (R305)', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [deletingTab, typingTab] = tabs
    deleteBlock(deletingTab, 1)
    typeAt(deletingTab, 'xyz', 0, 'de')
    typeAt(deletingTab, 'dexyz', 5, 'fgh')
    typeQQ(typingTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect(blocks(deletingTab)).toEqual(['paragraph abc', 'paragraph dexyzfgh'])
    expect(blocks(typingTab)).toEqual(blocks(deletingTab))
    expect(typingTab.reported).toEqual([lostQQ])
  })

  it('reports when the text is short, even where a whole run the row typed matches it', async () => {
    const tabs = await openTabs(stored(paragraph(text('ab')), paragraph(text('xyz'))), 2)
    const [headingTab, typingTab] = tabs
    makeHeading(headingTab, 'ab')
    typeAt(headingTab, 'ab', 1, 'X')
    typeAt(headingTab, 'xyz', 3, 'ab')
    typeQQ(typingTab, 'ab')

    await sendInOrder(tabs, tabs)

    expect(blocks(headingTab)).toEqual(['heading aXb', 'paragraph xyzab'])
    expect(blocks(typingTab)).toEqual(blocks(headingTab))
    const runs = [{ offset: 2, text: 'QQ', attrs: {} }]
    const lost = {
      kind: 'text',
      seen: 'ab',
      runs,
      written: expect.anything(),
      pulled: expect.anything(),
      isUncertain: false,
    }
    expect(typingTab.reported).toEqual([lost])
  })

  it('reports a removal with nothing seen without looking for a place (R279)', () => {
    const ydoc = new yjs.Doc()
    const body = ydoc.getXmlFragment('body')
    const line = new yjs.XmlText()
    body.insert(0, [line])
    line.insert(0, 'abc')
    const written = {
      before: new Map<number, number>(),
      after: yjs.decodeStateVector(yjs.encodeStateVector(ydoc)),
    }

    const removal = {
      kind: 'text' as const,
      seen: '',
      runs: [{ offset: 0, text: 'QQ', attrs: {} }],
      written,
      pulled: written,
      isUncertain: false,
    }
    expect(typeBack(ydoc, removal)).toBe(false)
  })
})

// Each text node of block `index` with its mark names
function markedParts(tab: Tab, index: number) {
  const parts: [string, string[]][] = []
  const block = tab.editor.state.doc.child(index)
  for (let child = 0; child < block.childCount; child++) {
    const node = block.child(child)
    parts.push([node.text ?? '', node.marks.map((mark) => mark.type.name)])
  }

  return parts
}

describe('typed-back text keeps its own marks (R281)', () => {
  it('comes back bold between plain text', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [headingTab, typingTab] = tabs
    makeHeading(headingTab, 'defgh')
    typeAt(typingTab, 'defgh', 2, { type: 'text', text: 'QQ', marks: [{ type: 'bold' }] })

    await sendInOrder(tabs, tabs)

    expect(markedParts(headingTab, 1)).toEqual([
      ['de', []],
      ['QQ', ['bold']],
      ['fgh', []],
    ])
    expect(typingTab.editor.getJSON()).toEqual(headingTab.editor.getJSON())
    expect(allReported(tabs)).toEqual([])
  })

  it('comes back plain after bold text', async () => {
    const bold = { type: 'text', text: 'fgh', marks: [{ type: 'bold' }] }
    const base = stored(paragraph(text('abc')), paragraph(text('de'), bold), paragraph(text('xyz')))
    const tabs = await openTabs(base, 2)
    const [headingTab, typingTab] = tabs
    makeHeading(headingTab, 'fgh')
    typingTab.editor
      .chain()
      .setTextSelection(inside(typingTab, 'fgh', 1))
      .unsetBold()
      .insertContent('QQ')
      .run()

    await sendInOrder(tabs, tabs)

    expect(markedParts(headingTab, 1)).toEqual([
      ['de', []],
      ['f', ['bold']],
      ['QQ', []],
      ['gh', ['bold']],
    ])
    expect(typingTab.editor.getJSON()).toEqual(headingTab.editor.getJSON())
    expect(allReported(tabs)).toEqual([])
  })
})

// A makes block 1 a heading, B joins block 2 up into it, C types in block 2
describe('three tabs restructuring and typing at once', () => {
  async function threeTabs() {
    const tabs = await openTabs(threeParagraphs, 3)
    const [headingTab, joinTab, typingTab] = tabs
    makeHeading(headingTab, 'abc')
    joinUp(joinTab, 'defgh')
    typeQQ(typingTab, 'defgh')
    return tabs
  }

  it("reports C's typing when A's row lands before B's", async () => {
    const tabs = await threeTabs()
    const [headingTab, joinTab, typingTab] = tabs

    await sendInOrder(tabs, [headingTab, joinTab, typingTab])

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual(['heading abcdefgh', 'paragraph xyz'])
    }

    expect(typingTab.reported).toEqual([lostQQ])
    expect([...headingTab.reported, ...joinTab.reported]).toEqual([])
  })

  it("reports C's typing when B's row lands before A's", async () => {
    const tabs = await threeTabs()
    const [headingTab, joinTab, typingTab] = tabs

    await sendInOrder(tabs, [joinTab, headingTab, typingTab])

    for (const tab of tabs) {
      expect(blocks(tab)).toEqual(['heading abcdefgh', 'paragraph xyz'])
    }

    const runs = [{ offset: 3, text: 'QQ', attrs: {} }]
    const uncertain = {
      kind: 'text',
      seen: 'abc',
      runs,
      written: expect.anything(),
      pulled: expect.anything(),
      isUncertain: true,
    }
    expect(typingTab.reported).toEqual([uncertain])
    expect([...headingTab.reported, ...joinTab.reported]).toEqual([])
  })
})

describe('removals that are not reported', () => {
  it('stays quiet when a tab deletes a block after seeing the text in it', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [deletingTab, typingTab] = tabs
    typeQQ(typingTab, 'defgh')
    await syncAll(tabs)
    deleteBlock(deletingTab, 1)

    await syncAll(tabs)

    expect(blocks(typingTab)).toEqual(['paragraph abc', 'paragraph xyz'])
    expect(allReported(tabs)).toEqual([])
  })

  it('stays quiet when two tabs set the same attributes and one value wins', async () => {
    const base = stored(
      { type: 'heading', attrs: { level: 1 }, content: [text('abc')] },
      paragraph(
        text('de'),
        { type: 'image', attrs: { src: '/files/x.png', width: 100, height: 50 } },
        { type: 'mention', attrs: { id: 'ann', label: 'Ann' } },
        text('fgh'),
      ),
    )
    const tabs = await openTabs(base, 2)
    function setAll(tab: Tab, level: number, width: number, label: string) {
      const image = positionOf(tab, 'image')
      const mentionAt = positionOf(tab, 'mention')
      tab.editor
        .chain()
        .setTextSelection(inside(tab, 'abc'))
        .updateAttributes('heading', { level })
        .run()
      tab.editor.chain().setNodeSelection(image).updateAttributes('image', { width }).run()
      tab.editor.chain().setNodeSelection(mentionAt).updateAttributes('mention', { label }).run()
    }

    setAll(tabs[0], 2, 200, 'Annie')
    setAll(tabs[1], 3, 300, 'Anna')

    await sendInOrder(tabs, tabs)

    expect(tabs[1].editor.getJSON()).toEqual(tabs[0].editor.getJSON())
    expect(allReported(tabs)).toEqual([])
  })
})

function positionOf(tab: Tab, name: string) {
  let found = -1
  tab.editor.state.doc.descendants((node, position) => {
    if (found < 0 && node.type.name === name) {
      found = position
    }

    return found < 0
  })
  return found
}

describe('removals that are reported', () => {
  it('reports text when the other tab deleted its block at the same time', async () => {
    const tabs = await openTabs(threeParagraphs, 2)
    const [deletingTab, typingTab] = tabs
    deleteBlock(deletingTab, 1)
    typeQQ(typingTab, 'defgh')

    await sendInOrder(tabs, tabs)

    expect(blocks(typingTab)).toEqual(['paragraph abc', 'paragraph xyz'])
    expect(typingTab.reported).toEqual([lostQQ])
    expect(deletingTab.reported).toEqual([])
  })

  const inlineNodes: [string, object][] = [
    ['hardBreak', { type: 'hardBreak' }],
    ['mention', { type: 'mention', attrs: { id: 'ann', label: 'Ann' } }],
    ['image', { type: 'image', attrs: { src: '/files/x.png', width: 100, height: 50 } }],
  ]

  it.each(inlineNodes)(
    'reports a %s the other tab removed by making its block a heading',
    async (name, node) => {
      const tabs = await openTabs(threeParagraphs, 2)
      const [headingTab, insertingTab] = tabs
      makeHeading(headingTab, 'defgh')
      insertingTab.editor
        .chain()
        .setTextSelection(inside(insertingTab, 'defgh', 2))
        .insertContent(node)
        .run()

      await sendInOrder(tabs, tabs)

      expect(blocks(headingTab)).toEqual(['paragraph abc', 'heading defgh', 'paragraph xyz'])
      expect(positionOf(headingTab, name)).toBe(-1)
      expect(insertingTab.reported).toContainEqual(expect.objectContaining({ kind: 'node', name }))
      expect(headingTab.reported).toEqual([])
    },
  )
})
