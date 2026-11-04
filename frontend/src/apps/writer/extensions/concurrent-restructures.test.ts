import { describe, expect, it, vi } from 'vitest'

import { inside, openTabs, stored, syncAll, type Tab } from '../collab/test-support'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function bulletList(text: string) {
  return { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text)] }] }
}

async function race(base: Uint8Array, first: (tab: Tab) => void, second: (tab: Tab) => void) {
  const tabs = await openTabs(base, 2)
  const [left, right] = tabs
  first(left)
  second(right)
  await syncAll(tabs)
  return tabs.map((tab) => tab.editor.state.doc.textContent)
}

const threeParagraphs = stored(paragraph('abc'), paragraph('defgh'), paragraph('xyz'))

function typeQQ(tab: Tab, word: string) {
  tab.editor
    .chain()
    .setTextSelection(inside(tab, word, 2))
    .insertContent('QQ')
    .run()
}

// Two people restructuring one block at once keep both copies of it (owner, 2026-10-14): nothing is lost
describe('concurrent restructures of one block', () => {
  it('keeps both copies when both wrap the last block in a different list', async () => {
    const texts = await race(
      threeParagraphs,
      (tab) => tab.editor.chain().setTextSelection(inside(tab, 'xyz')).toggleBulletList().run(),
      (tab) => {
        tab.editor.chain().setTextSelection(inside(tab, 'xyz')).toggleTaskList().run()
        typeQQ(tab, 'xyz')
      },
    )

    expect(texts[1]).toBe(texts[0])
    expect(texts[0].match(/xy(QQ)?z/g)).toEqual(expect.arrayContaining(['xyQQz', 'xyz']))
    expect(texts[0]).toContain('abcdefgh')
  })

  it('keeps both copies when both make the block a heading', async () => {
    const texts = await race(
      threeParagraphs,
      (tab) =>
        tab.editor
          .chain()
          .setTextSelection(inside(tab, 'defgh'))
          .setNode('heading', { level: 2 })
          .run(),
      (tab) => {
        tab.editor
          .chain()
          .setTextSelection(inside(tab, 'defgh'))
          .setNode('heading', { level: 3 })
          .run()
        typeQQ(tab, 'defgh')
      },
    )

    expect(texts[1]).toBe(texts[0])
    expect(texts[0].match(/de(QQ)?fgh/g)).toHaveLength(2)
    expect(texts[0]).toContain('deQQfgh')
  })

  it('keeps both copies when one joins the block up and the other makes it a heading', async () => {
    const texts = await race(
      threeParagraphs,
      (tab) =>
        tab.editor
          .chain()
          .setTextSelection(inside(tab, 'defgh', 0))
          .joinBackward()
          .run(),
      (tab) => {
        tab.editor
          .chain()
          .setTextSelection(inside(tab, 'defgh'))
          .setNode('heading', { level: 2 })
          .run()
        typeQQ(tab, 'defgh')
      },
    )

    expect(texts[1]).toBe(texts[0])
    expect(texts[0].match(/de(QQ)?fgh/g)).toHaveLength(2)
    expect(texts[0]).toContain('deQQfgh')
  })

  it('keeps the second list twice when both delete the paragraph between two lists', async () => {
    const base = stored(bulletList('abc'), paragraph('gap'), bulletList('def'), paragraph('end'))
    function deleteGap(tab: Tab) {
      const { doc } = tab.editor.state
      const from = doc.child(0).nodeSize
      tab.editor.commands.deleteRange({ from, to: from + doc.child(1).nodeSize })
    }

    const texts = await race(base, deleteGap, deleteGap)

    expect(texts[1]).toBe(texts[0])
    expect(texts[0].match(/abc|def|end/g)).toEqual(['abc', 'def', 'def', 'end'])
  })
})
