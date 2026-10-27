import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUpdate, Doc, encodeStateAsUpdate, XmlElement, XmlText } from 'yjs'

import { convertLegacy } from '@/apps/writer/collab/conversion'
import { BODY_FIELD } from '@/apps/writer/collab/field'
import {
  bodyOf,
  convert,
  DRIVE_THREAD,
  legacyDoc,
  MAX_STATE,
  oldComment,
  openConverted,
  shown,
  stored,
  yComments,
  yElement,
  yMarked,
  yParagraph,
} from '@/apps/writer/collab/legacy-fixtures'
import { writerSchema } from '@/apps/writer/schema'

type Open = (doc: Doc) => Editor

const opener = vi.hoisted(() => ({ open: null as null | ((open: Open, doc: Doc) => Editor) }))

vi.mock('@/apps/writer/collab/tab-editor', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/apps/writer/collab/tab-editor')>()
  function tabEditor(doc: Doc) {
    if (opener.open) {
      return opener.open(real.tabEditor, doc)
    }

    return real.tabEditor(doc)
  }

  return { tabEditor }
})

afterEach(() => {
  opener.open = null
})

function list(...items: XmlElement[]) {
  return yElement('bulletList', ...items.map((item) => yElement('listItem', item)))
}

// The words of the first paragraph gone from what the editor is shown, while the state stays as is
function withoutFirstWords(open: Open, doc: Doc) {
  const copy = new Doc()
  applyUpdate(copy, encodeStateAsUpdate(doc))
  const first = copy.getXmlFragment(BODY_FIELD).get(0) as XmlElement
  const text = first.get(0) as XmlText
  text.delete(0, text.length)
  return open(copy)
}

// The state with a block the editor can't build added, which freezes the editor as it opens
function withUnbuildable(open: Open, doc: Doc) {
  const copy = new Doc()
  applyUpdate(copy, encodeStateAsUpdate(doc))
  copy.getXmlFragment(BODY_FIELD).push([yElement('paragraph', yParagraph('in'))])
  return open(copy)
}

describe('convertLegacy', () => {
  it('converts two lists side by side, which a tab opens as they are', () => {
    const legacy = stored(
      legacyDoc(list(yParagraph('one')), list(yMarked('see', { comment: { commentId: 'c1' } }))),
    )

    const result = convert(legacy)

    expect(bodyOf(result.state).content.map(({ type }: { type: string }) => type)).toEqual([
      'bulletList',
      'bulletList',
    ])
    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 12,
      to: 15,
      text: 'see',
    })
  })

  it('refuses a body a tab would write to as it opens', () => {
    opener.open = (open, doc) => {
      const editor = open(doc)
      editor.commands.insertContentAt(1, 'x')
      return editor
    }

    const legacy = stored(legacyDoc(yParagraph('one')))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses a body a tab would open frozen', () => {
    opener.open = withUnbuildable
    const legacy = stored(legacyDoc(yParagraph('one')))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses a body when the tab check throws', () => {
    opener.open = () => {
      throw new Error('no tab')
    }

    const legacy = stored(legacyDoc(yParagraph('one')))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses a body when the tab opens with no sync binding', () => {
    opener.open = () =>
      new Editor({ element: document.createElement('div'), extensions: writerSchema() })

    const legacy = stored(legacyDoc(yParagraph('one')))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each([
    { name: 'a comment', mark: { comment: { commentId: 'c1' } } },
    { name: "a 2023 thread's comment", mark: { comment: { comment: DRIVE_THREAD } } },
  ])('refuses a body where a tab would not show $name on its words', ({ mark }) => {
    opener.open = withoutFirstWords
    const legacy = stored(legacyDoc(yMarked('see', mark), yParagraph('two')))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses a body where a tab would not show a comment kept beside it on its words', () => {
    opener.open = withoutFirstWords
    const doc = legacyDoc(yParagraph('see'), yParagraph('two'))
    const legacy = { ...stored(doc), ycomments: yComments({ c1: oldComment(doc, 'c1', 1, 4) }) }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })
})
