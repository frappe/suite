import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab'
import { restoreEdit } from '@/apps/writer/collab/restore'
import { writerSchema } from '@/apps/writer/schema'

const schema = getSchema(writerSchema())

function text(value: string, marks: string[] = []) {
  const node = { type: 'text', text: value }
  if (!marks.length) {
    return node
  }

  return { ...node, marks: marks.map((type) => ({ type })) }
}

function paragraph(...content: object[]) {
  return { type: 'paragraph', content }
}

function heading(value: string) {
  return { type: 'heading', attrs: { level: 2 }, content: [text(value)] }
}

function page(...content: object[]) {
  return schema.nodeFromJSON({ type: 'doc', content }).toJSON()
}

// What a reader sees: equal-mark runs Yjs may keep apart read as one
function shown(doc: Y.Doc) {
  return schema.nodeFromJSON(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(BODY_FIELD))).toJSON()
}

function documentOf(content: object) {
  return prosemirrorJSONToYDoc(schema, content, BODY_FIELD)
}

function copyOf(doc: Y.Doc) {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

function textAt(doc: Y.Doc, ...path: number[]) {
  let node: Y.XmlFragment | Y.XmlElement | Y.XmlText = doc.getXmlFragment(BODY_FIELD)
  for (const index of path) {
    node = (node as Y.XmlElement).get(index) as Y.XmlElement | Y.XmlText
  }

  return node as Y.XmlText
}

// The text an anchor covers now: empty once its characters are gone, null once split across blocks
function quoted(doc: Y.Doc, anchor: { from: Y.RelativePosition; to: Y.RelativePosition }) {
  const from = Y.createAbsolutePositionFromRelativePosition(anchor.from, doc)
  const to = Y.createAbsolutePositionFromRelativePosition(anchor.to, doc)
  if (!from || !to || from.type !== to.type) {
    return null
  }

  return (from.type as Y.XmlText).toString().slice(from.index, to.index)
}

function anchorOn(node: Y.XmlText, from: number, to: number) {
  return {
    from: Y.createRelativePositionFromTypeIndex(node, from),
    to: Y.createRelativePositionFromTypeIndex(node, to),
  }
}

function restore(current: Y.Doc, lineage: string, version: Y.Doc, versionLineage = lineage) {
  restoreEdit(current, lineage, { lineage: versionLineage, state: Y.encodeStateAsUpdate(version) })
}

describe('restoreEdit', () => {
  it('makes the document exactly a version of its own lineage', () => {
    const current = documentOf(page(heading('Plan'), paragraph(text('Ship the first cut.'))))
    const version = copyOf(current)
    textAt(current, 1, 0).insert(0, 'Now ')
    textAt(current, 1, 0).format(4, 4, { bold: {} })
    textAt(current, 0, 0).delete(0, 2)
    current.getXmlFragment(BODY_FIELD).insert(1, [new Y.XmlElement('paragraph')])

    restore(current, 'one', version)

    expect(shown(current)).toEqual(page(heading('Plan'), paragraph(text('Ship the first cut.'))))
  })

  it('keeps the text both hold, so threads on it stay', () => {
    const current = documentOf(page(paragraph(text('alpha bravo charlie'))))
    const version = copyOf(current)
    const body = textAt(current, 0, 0)
    const onBravo = anchorOn(body, 6, 11)
    body.insert(0, 'new ')
    body.delete(10, 5)
    const onNew = anchorOn(body, 0, 3)

    restore(current, 'one', version)

    expect(shown(current)).toEqual(page(paragraph(text('alpha bravo charlie'))))
    expect(quoted(current, onBravo)).toBe('bravo')
    expect(quoted(current, onNew)).toBe('')
  })

  it('brings back text cut since the version as new text', () => {
    const current = documentOf(page(paragraph(text('keep this')), paragraph(text('and this'))))
    const version = copyOf(current)
    current.getXmlFragment(BODY_FIELD).delete(1, 1)
    textAt(current, 0, 0).delete(4, 5)

    restore(current, 'one', version)

    expect(shown(current)).toEqual(page(paragraph(text('keep this')), paragraph(text('and this'))))
  })

  it('puts back formatting and block attributes', () => {
    const current = documentOf(
      page(paragraph(text('plain '), text('bold', ['bold'])), heading('Title')),
    )
    const version = copyOf(current)
    textAt(current, 0, 0).format(0, 10, { bold: null, italic: {} })
    ;(current.getXmlFragment(BODY_FIELD).get(1) as Y.XmlElement).setAttribute('level', 3 as never)

    restore(current, 'one', version)

    expect(shown(current)).toEqual(
      page(paragraph(text('plain '), text('bold', ['bold'])), heading('Title')),
    )
  })

  it('counts an emoji as the two units Yjs does', () => {
    const current = documentOf(page(paragraph(text('a😀b😀c'))))
    const version = copyOf(current)
    const body = textAt(current, 0, 0)
    body.delete(3, 2)
    body.format(0, 3, { bold: {} })
    body.insert(1, '🎉')

    restore(current, 'one', version)

    expect(shown(current)).toEqual(page(paragraph(text('a😀b😀c'))))
  })

  it('matches a version of another lineage by content', () => {
    const current = documentOf(page(paragraph(text('today'))))
    const version = documentOf(page(heading('Then'), paragraph(text('yesterday', ['italic']))))

    restore(current, 'one', version, 'two')

    expect(shown(current)).toEqual(page(heading('Then'), paragraph(text('yesterday', ['italic']))))
  })

  it.each([
    { name: 'another lineage', versionLineage: 'other' },
    { name: 'its own lineage', versionLineage: 'own' },
  ])('brings back an old image of a version of $name as an image', ({ versionLineage }) => {
    const version = new Y.Doc()
    const old = new Y.XmlElement('resizableMedia')
    old.setAttribute('src', '/private/files/chart.png')
    old.setAttribute('media-type', 'img')
    version.getXmlFragment(BODY_FIELD).insert(0, [old])
    const current = copyOf(version)
    current.getXmlFragment(BODY_FIELD).delete(0, 1)

    restore(current, 'own', version, versionLineage)

    const image = { type: 'image', attrs: { src: '/private/files/chart.png', align: 'left' } }
    expect(shown(current)).toEqual(page(paragraph(image)))
  })

  it('makes the document a migrated HTML version', () => {
    const current = documentOf(page(paragraph(text('today'))))

    restoreEdit(current, 'one', { html: '<h2>Then</h2><p>was <strong>this</strong></p>' })

    expect(shown(current)).toEqual(
      page(heading('Then'), paragraph(text('was '), text('this', ['bold']))),
    )
  })

  it("restores the version's first tab label and drops one it never had", () => {
    const current = documentOf(page(paragraph(text('body'))))
    const named = copyOf(current)
    named.getMap('meta').set('firstTabLabel', 'Intro')
    current.getMap('meta').set('firstTabLabel', 'Later')

    restore(current, 'one', named)
    expect(current.getMap('meta').get('firstTabLabel')).toBe('Intro')

    restoreEdit(current, 'one', { html: '<p>body</p>' })
    expect(current.getMap('meta').has('firstTabLabel')).toBe(false)
  })

  it("is one edit under this tab's client id, which every other copy takes the same way", () => {
    const current = documentOf(page(paragraph(text('alpha bravo'))))
    const version = copyOf(current)
    textAt(current, 0, 0).insert(5, ' and')
    textAt(current, 0, 0).delete(0, 2)
    const other = copyOf(current)
    const tab = current.clientID
    const updates: Uint8Array[] = []
    current.on('update', (update: Uint8Array) => updates.push(update))

    restore(current, 'one', version)
    Y.applyUpdate(other, updates[0])

    const writers = Y.parseUpdateMeta(updates[0]).to
    expect([updates.length, [...writers.keys()], current.clientID]).toEqual([1, [tab], tab])
    expect(shown(other)).toEqual(shown(current))
  })
})
