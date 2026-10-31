import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRelativePositionFromTypeIndex,
  Doc,
  encodeRelativePosition,
  encodeStateAsUpdate,
  XmlElement,
  XmlText,
} from 'yjs'

import { convertLegacy } from '@/apps/writer/collab/conversion'
import { BODY_FIELD } from '@/apps/writer/collab/field'
import {
  convert,
  DRIVE_THREAD,
  htmlComment,
  legacyDoc,
  MAX_STATE,
  oldComment,
  oldMedia,
  openConverted,
  shown,
  SRC,
  stored,
  toBase64,
  yAtom,
  yComments,
  yElement,
  yMarked,
  yParagraph,
} from '@/apps/writer/collab/legacy-fixtures'
import { placeThread } from '@/apps/writer/collab/places'

const REFUSED = { kind: 'failed', reason: 'check' }
const MENTION = '<span class="mention" data-type="mention" data-id="x" data-label="Ann">@Ann</span>'

const forced = vi.hoisted(() => ({ isUnitLost: false, isPlaceShifted: false, calls: 0, key: '' }))

vi.mock('@/apps/writer/collab/old-comments', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/apps/writer/collab/old-comments')>()
  function bodyUnits(...args: Parameters<typeof real.bodyUnits>) {
    const units = real.bodyUnits(...args)
    forced.calls += 1
    if (!forced.isUnitLost || forced.calls === 1) {
      return units
    }

    return { ...units, tokens: units.tokens.slice(1), places: units.places.slice(1) }
  }

  return { ...real, bodyUnits }
})

vi.mock('@tiptap/y-tiptap', async (importOriginal) => {
  const real = await importOriginal<typeof import('@tiptap/y-tiptap')>()
  function absolutePositionToRelativePosition(
    ...[place, ...rest]: Parameters<typeof real.absolutePositionToRelativePosition>
  ) {
    if (forced.isPlaceShifted) {
      return real.absolutePositionToRelativePosition(place + 1, ...rest)
    }

    return real.absolutePositionToRelativePosition(place, ...rest)
  }

  return { ...real, absolutePositionToRelativePosition }
})

vi.mock('uuid', async (importOriginal) => {
  const real = await importOriginal<typeof import('uuid')>()
  function v4() {
    return forced.key || real.v4()
  }

  return { ...real, v4 }
})

afterEach(() => {
  Object.assign(forced, { isUnitLost: false, isPlaceShifted: false, calls: 0, key: '' })
})

function withComments(doc: Doc, ...entries: { id: string; [key: string]: unknown }[]) {
  const byKey = Object.fromEntries(entries.map((entry) => [entry.id, entry]))
  return { ...stored(doc), ycomments: yComments(byKey) }
}

function html(body: string, ...entries: { id: string; [key: string]: unknown }[]) {
  const byKey = Object.fromEntries(entries.map((entry) => [entry.id, entry]))
  return { content: null, html: body, collab: 0, ycomments: yComments(byKey) }
}

function endIn(text: XmlText) {
  return encodeRelativePosition(createRelativePositionFromTypeIndex(text, 1))
}

function textOf(doc: Doc, index: number) {
  return (doc.getXmlFragment(BODY_FIELD).get(index) as XmlElement).get(0) as XmlText
}

const DELETED = [{ kind: 'comment-deleted', id: 'c1' }]

describe('convertLegacy, a Yjs document with comments kept beside the body', () => {
  it('places a comment with no mark on its words', () => {
    const doc = legacyDoc(yParagraph('one two three'))
    const legacy = withComments(doc, oldComment(doc, 'c1', 5, 8))

    const result = convert(legacy)

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 8,
      text: 'two',
    })
    expect(result.dropped).toEqual([])
  })

  it('places a comment on what is left of its words', () => {
    const doc = legacyDoc(yParagraph('one two three'))
    const comment = oldComment(doc, 'c1', 5, 14)
    textOf(doc, 0).delete(4, 4)

    const result = convert(withComments(doc, comment))

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 10,
      text: 'three',
    })
  })

  it('places a comment after old media, which the conversion rewrites', () => {
    const media = oldMedia({ src: SRC, 'media-type': 'img' })
    const doc = legacyDoc(media, yParagraph('one two'))
    const comment = oldComment(doc, 'c1', 5, 8)

    const result = convert(withComments(doc, comment))

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 8,
      to: 11,
      text: 'two',
    })
  })

  it('places a comment on a mention alone', () => {
    const doc = legacyDoc(
      yElement('paragraph', new XmlText('hi '), yAtom('mention', { id: 'x', label: 'Ann' })),
    )

    const result = convert(withComments(doc, oldComment(doc, 'c1', 4, 5)))

    expect(placeThread(openConverted(result.state).state, result.anchors.c1)).toEqual({
      kind: 'text',
      from: 4,
      to: 5,
      quote: '@Ann',
    })
  })

  it('places a comment across two paragraphs', () => {
    const doc = legacyDoc(yParagraph('one two'), yParagraph('three four'))

    const result = convert(withComments(doc, oldComment(doc, 'c1', 5, 15)))

    expect(placeThread(openConverted(result.state).state, result.anchors.c1)).toEqual({
      kind: 'text',
      from: 5,
      to: 15,
      quote: 'two three',
    })
  })

  it('places a resolved comment the same way', () => {
    const doc = legacyDoc(yParagraph('one two three'))
    const legacy = withComments(doc, { ...oldComment(doc, 'c1', 5, 8), resolved: true })

    const result = convert(legacy)

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 8,
      text: 'two',
    })
  })

  it("places a comment beside a 2023 thread's mark, each on its own words", () => {
    const doc = legacyDoc(
      yMarked('see', { comment: { comment: DRIVE_THREAD } }),
      yParagraph('one two'),
    )

    const result = convert(withComments(doc, oldComment(doc, 'c1', 10, 13)))

    const editor = openConverted(result.state)
    expect(shown(editor, result.threads[0].anchor)).toEqual({ from: 1, to: 4, text: 'see' })
    expect(shown(editor, result.anchors.c1)).toEqual({ from: 10, to: 13, text: 'two' })
  })

  it('converts a marked comment and a placed one, both of which a tab shows on their words', () => {
    const doc = legacyDoc(yMarked('see', { comment: { commentId: 'c1' } }), yParagraph('one two'))

    const result = convert(withComments(doc, oldComment(doc, 'c2', 10, 13)))

    const editor = openConverted(result.state)
    expect(shown(editor, result.anchors.c1)).toEqual({ from: 1, to: 4, text: 'see' })
    expect(shown(editor, result.anchors.c2)).toEqual({ from: 10, to: 13, text: 'two' })
    expect(result.dropped).toEqual([])
  })

  it('keeps the mark of a comment it also lists, recording nothing', () => {
    const doc = legacyDoc(yMarked('see', { comment: { commentId: 'c1' } }), yParagraph('one two'))

    const result = convert(withComments(doc, oldComment(doc, 'c1', 10, 13)))

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 1,
      to: 4,
      text: 'see',
    })
    expect(result.dropped).toEqual([])
  })

  it('records a comment whose words were all deleted', () => {
    const doc = legacyDoc(yParagraph('one two three'))
    const comment = oldComment(doc, 'c1', 5, 8)
    textOf(doc, 0).delete(4, 3)

    const result = convert(withComments(doc, comment))

    expect([result.anchors, result.dropped]).toEqual([{}, DELETED])
  })

  it('records a comment whose paragraph was deleted', () => {
    const doc = legacyDoc(yParagraph('one'), yParagraph('two'))
    const comment = oldComment(doc, 'c1', 6, 9)
    doc.getXmlFragment(BODY_FIELD).delete(1, 1)

    const result = convert(withComments(doc, comment))

    expect([result.anchors, result.dropped]).toEqual([{}, DELETED])
  })

  it('records a comment whose first paragraph was deleted, though its last is still there', () => {
    const doc = legacyDoc(yParagraph('one'), yParagraph('two'))
    const comment = oldComment(doc, 'c1', 2, 9)
    doc.getXmlFragment(BODY_FIELD).delete(0, 1)

    const result = convert(withComments(doc, comment))

    expect([result.anchors, result.dropped]).toEqual([{}, DELETED])
  })

  it('records a comment on no words', () => {
    const doc = legacyDoc(yParagraph('one two three'))

    const result = convert(withComments(doc, oldComment(doc, 'c1', 5, 5)))

    expect([result.anchors, result.dropped]).toEqual([{}, DELETED])
  })

  it('records a comment with no start', () => {
    const doc = legacyDoc(yParagraph('one two three'))
    const comment = oldComment(doc, 'c1', 5, 8)

    const result = convert(withComments(doc, { ...comment, anchor: { to: comment.anchor.to } }))

    expect([result.anchors, result.dropped]).toEqual([{}, DELETED])
  })

  it('records a comment on an image alone', () => {
    const image = yAtom('image', { src: SRC })
    const doc = legacyDoc(yElement('paragraph', new XmlText('one '), image, new XmlText(' two')))

    const result = convert(withComments(doc, oldComment(doc, 'c1', 5, 6)))

    expect([result.anchors, result.dropped]).toEqual([{}, DELETED])
  })

  it.each([
    {
      name: 'comments it cannot read',
      ycomments: () => '%%%',
    },
    {
      name: 'a comment kept under another key',
      ycomments: (doc: Doc) => yComments({ c2: oldComment(doc, 'c1', 5, 8) }),
    },
    {
      name: 'a comment whose place is not a map',
      ycomments: (doc: Doc) => yComments({ c1: { ...oldComment(doc, 'c1', 5, 8), anchor: 'two' } }),
    },
    {
      name: 'a comment whose end is not kept as bytes',
      ycomments: (doc: Doc) => {
        const comment = oldComment(doc, 'c1', 5, 8)
        return yComments({ c1: { ...comment, anchor: { ...comment.anchor, to: [1, 2] } } })
      },
    },
    {
      name: 'a comment whose start it cannot read',
      ycomments: (doc: Doc) => {
        const comment = oldComment(doc, 'c1', 5, 8)
        const anchor = { ...comment.anchor, from: new Uint8Array([255]) }
        return yComments({ c1: { ...comment, anchor } })
      },
    },
  ])('refuses $name', ({ ycomments }) => {
    const doc = legacyDoc(yParagraph('one two three'))

    expect(convertLegacy({ ...stored(doc), ycomments: ycomments(doc) }, MAX_STATE)).toEqual(REFUSED)
  })

  it("refuses a comment kept under a 2023 thread's key", () => {
    forced.key = 'k1'
    const doc = legacyDoc(
      yMarked('see', { comment: { comment: DRIVE_THREAD } }),
      yParagraph('one two'),
    )

    expect(convertLegacy(withComments(doc, oldComment(doc, 'k1', 10, 13)), MAX_STATE)).toEqual(
      REFUSED,
    )
  })

  it('refuses a comment whose words the new body no longer holds in the same order', () => {
    forced.isUnitLost = true
    const doc = legacyDoc(yParagraph('one two three'))

    expect(convertLegacy(withComments(doc, oldComment(doc, 'c1', 5, 8)), MAX_STATE)).toEqual(
      REFUSED,
    )
  })
})

describe('convertLegacy, a Yjs document with a comment ending where the body is not read', () => {
  it('refuses a comment ending outside the body', () => {
    const doc = legacyDoc(yParagraph('one two three'))
    const outside = new XmlText('two')
    doc.getXmlFragment('elsewhere').insert(0, [yElement('paragraph', outside)])
    const comment = oldComment(doc, 'c1', 5, 8)

    const legacy = withComments(doc, {
      ...comment,
      anchor: { ...comment.anchor, to: endIn(outside) },
    })

    expect(convertLegacy(legacy, MAX_STATE)).toEqual(REFUSED)
  })
})

describe('convertLegacy, an HTML document with comments kept beside the body', () => {
  it('places a comment on the only place its words are', () => {
    const result = convert(html('<p>one two three</p>', htmlComment('c1', 'two')))

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 8,
      text: 'two',
    })
    expect(result.dropped).toEqual([])
  })

  it('places a comment across two paragraphs, read with a space between them', () => {
    const result = convert(html('<p>one two</p><p>three four</p>', htmlComment('c1', 'two three')))

    expect(placeThread(openConverted(result.state).state, result.anchors.c1)).toEqual({
      kind: 'text',
      from: 5,
      to: 15,
      quote: 'two three',
    })
  })

  it('places a comment across a mention, which the old editor read as nothing', () => {
    const result = convert(html(`<p>hi ${MENTION} there</p>`, htmlComment('c1', 'hi  there')))

    expect(placeThread(openConverted(result.state).state, result.anchors.c1)).toEqual({
      kind: 'text',
      from: 1,
      to: 11,
      quote: 'hi @Ann there',
    })
  })

  it('places a comment from the HTML read in place of a Yjs body holding nothing', () => {
    const legacy = {
      content: toBase64(encodeStateAsUpdate(new Doc())),
      html: '<p>one two three</p>',
      collab: 1,
      ycomments: yComments({ c1: htmlComment('c1', 'two') }),
    }

    const result = convert(legacy)

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 8,
      text: 'two',
    })
  })

  it.each([
    { name: 'its words are in two places', body: '<p>two and two</p>', words: 'two' },
    { name: 'its words overlap themselves', body: '<p>aaa</p>', words: 'aa' },
    { name: 'its words are gone', body: '<p>one two</p>', words: 'four' },
    { name: 'its words are only a space', body: '<p>one two</p>', words: ' ' },
  ])('records a comment when $name', ({ body, words }) => {
    const result = convert(html(body, htmlComment('c1', words)))

    expect([result.anchors, result.dropped]).toEqual([{}, DELETED])
  })

  it('refuses a comment its own placing would put on other words', () => {
    forced.isPlaceShifted = true

    expect(
      convertLegacy(html('<p>one two three</p>', htmlComment('c1', 'two')), MAX_STATE),
    ).toEqual(REFUSED)
  })

  it.each([
    { name: 'an empty span', body: '<p>one <span data-comment-id="c1"></span></p>' },
    {
      name: 'a span holding only a space the page drops',
      body: '<p>one <span data-comment-id="c1"> </span></p>',
    },
    {
      name: 'a paragraph holding only a space',
      body: '<p><span data-comment-id="c1"> </span></p><p>two</p>',
    },
  ])('records a marked comment on $name, which leaves it no place', ({ body }) => {
    const result = convert(html(body))

    expect([result.anchors, result.dropped]).toEqual([{}, DELETED])
  })

  it('places a marked comment on the space between two words, recording nothing', () => {
    const result = convert(html('<p>one<span data-comment-id="c1"> </span>two</p>'))

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 4,
      to: 5,
      text: ' ',
    })
    expect(result.dropped).toEqual([])
  })
})
