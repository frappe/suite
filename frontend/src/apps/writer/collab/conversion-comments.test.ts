import { describe, expect, it } from 'vitest'
import { XmlElement, XmlText } from 'yjs'

import { convertLegacy } from '@/apps/writer/collab/conversion'
import { BODY_FIELD } from '@/apps/writer/collab/field'
import {
  bodyOf,
  convert,
  legacyDoc,
  MAX_STATE,
  openConverted,
  opened,
  page,
  paragraph,
  shown,
  stored,
  storedRuns,
  words,
  yAtom,
  yElement,
  yMarked,
  yParagraph,
  yRuns,
} from '@/apps/writer/collab/legacy-fixtures'
import { placeThread } from '@/apps/writer/collab/places'

describe('convertLegacy', () => {
  it.each([
    { name: 'an annotation', mark: { annotation: { annotationID: 'a1' } } },
    { name: 'an overlapping annotation', mark: { 'annotation--Ab+/9xY=': { annotationID: 'a2' } } },
    { name: 'a comment with no id', mark: { comment: { commentId: null } } },
    { name: 'a comment with an empty id', mark: { comment: { commentId: '' } } },
    { name: 'a comment with a blank id', mark: { comment: { commentId: ' ' } } },
    { name: 'a comment with a number for its id', mark: { comment: { commentId: 7 } } },
    {
      name: 'a hashed copy of a comment with no id',
      mark: { 'comment--a+/=bC9z': { commentId: null } },
    },
  ])('refuses a Yjs body holding $name, which no thread is made from yet', ({ mark }) => {
    const legacy = stored(legacyDoc(yMarked('see', mark)))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses a Yjs body holding an annotation on a mention', () => {
    const mention = new XmlElement('mention')
    mention.setAttribute('id', 'x')
    mention.setAttribute('label', 'Ann')
    mention.setAttribute('annotation', { annotationID: 'a1' } as never)
    const legacy = stored(legacyDoc(yElement('paragraph', new XmlText('hi '), mention)))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses a comment beside an annotation, which no thread is made from yet', () => {
    const comment = { comment: { commentId: 'c1' } }
    const annotation = { annotation: { annotationID: 'a1' } }
    const legacy = stored(legacyDoc(yRuns(['one', comment], [' '], ['two', annotation])))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses a Yjs document whose annotations list holds threads', () => {
    const doc = legacyDoc(yParagraph('one'))
    doc.getArray('docAnnotations').insert(0, [{ id: 'a1' }])

    expect(convertLegacy(stored(doc), MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses HTML holding an annotation', () => {
    const html = '<p><span data-annotation-id="a1">see</span></p>'

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('converts comments that carry their thread ids, in Yjs, as a lone overlapping copy read by its mark name and in HTML', () => {
    const yjs = stored(legacyDoc(yMarked('see', { comment: { commentId: 'c1' } })))
    const overlap = stored(legacyDoc(yMarked('see', { 'comment--a+/=bC9z': { commentId: 'c2' } })))
    const html = {
      content: null,
      html: '<p><span data-comment-id="c1">see</span></p>',
      collab: 0,
      ycomments: null,
    }

    const results = [yjs, overlap, html].map(convert)

    // The lone copy is drawn as a comment, so the converted body holds it under the plain key
    expect(results.map(({ anchors }) => Object.keys(anchors))).toEqual([['c1'], ['c2'], ['c1']])
  })

  it('refuses two comments on the same words, the second one having no anchor', () => {
    const both = { comment: { commentId: 'c1' }, 'comment--a+/=bC9z': { commentId: 'c2' } }
    const legacy = stored(legacyDoc(yMarked('see', both)))

    // Only the plain comment key moves onto an anchor; the hashed copy stays behind, so the body
    // no longer matches itself without comment marks
    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('anchors an old comment on its words and leaves no comment mark', () => {
    const marks = { comment: { commentId: 'c1' }, bold: {} }
    const doc = legacyDoc(yRuns(['one '], ['two', marks], [' three']))

    const result = convert(stored(doc))

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 8,
      text: 'two',
    })
    const bold = { type: 'text', text: 'two', marks: [{ type: 'bold' }] }
    const body = paragraph({ type: 'text', text: 'one ' }, bold, { type: 'text', text: ' three' })
    expect(bodyOf(result.state)).toEqual(page(body))
    expect(storedRuns(result.state, 0)).toEqual([
      ['one ', []],
      ['two', ['bold']],
      [' three', []],
    ])
  })

  it('anchors an old comment saved in the HTML on its words', () => {
    const html = '<p>one <span data-comment-id="c1">two</span> three</p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 8,
      text: 'two',
    })
    expect(bodyOf(result.state)).toEqual(page(words('one two three')))
  })

  it('anchors an old comment on a mention and takes the mark off the mention', () => {
    const mention = yAtom('mention', { id: 'x', label: 'Ann' })
    mention.setAttribute('comment', { commentId: 'c1' } as never)
    const doc = legacyDoc(yElement('paragraph', new XmlText('hi '), mention))

    const result = convert(stored(doc))

    expect(placeThread(openConverted(result.state).state, result.anchors.c1)).toEqual({
      kind: 'text',
      from: 4,
      to: 5,
      quote: '@Ann',
    })
    const shownMention = { type: 'mention', attrs: { id: 'x', label: 'Ann' } }
    const body = paragraph({ type: 'text', text: 'hi ' }, shownMention)
    expect(bodyOf(result.state)).toEqual(page(body))
    const block = opened(result.state).getXmlFragment(BODY_FIELD).get(0) as XmlElement
    const attributes = (block.get(1) as XmlElement).getAttributes()
    expect([Object.hasOwn(attributes, 'comment'), attributes.id, attributes.label]).toEqual([
      false,
      'x',
      'Ann',
    ])
  })

  it('records a far copy of a comment and keeps its words with their other marks', () => {
    const doc = legacyDoc(
      yRuns(['one '], ['two', { comment: { commentId: 'c1' } }]),
      yParagraph('filler'),
      yRuns(['copy', { comment: { commentId: 'c1' }, italic: {} }]),
    )

    const result = convert(stored(doc))

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 8,
      text: 'two',
    })
    expect(result.dropped).toEqual([{ kind: 'comment-copy', id: 'c1', text: 'copy' }])
    const italic = paragraph({ type: 'text', text: 'copy', marks: [{ type: 'italic' }] })
    expect(bodyOf(result.state)).toEqual(page(words('one two'), words('filler'), italic))
    expect(storedRuns(result.state, 2)).toEqual([['copy', ['italic']]])
  })

  it("keeps typing at a converted comment's edges outside it (R324)", () => {
    const doc = legacyDoc(yRuns(['one '], ['two', { comment: { commentId: 'c1' } }], [' three']))
    const result = convert(stored(doc))
    const editor = openConverted(result.state)

    editor.commands.insertContentAt(8, 'X')
    editor.commands.insertContentAt(5, 'X')

    expect([shown(editor, result.anchors.c1), editor.getText()]).toEqual([
      { from: 6, to: 9, text: 'two' },
      'one XtwoX three',
    ])
  })

  it('gives no anchors to a body with no comments', () => {
    expect(convert(stored(legacyDoc(yParagraph('one')))).anchors).toEqual({})
  })

  it('anchors a comment in three places far apart on the first, recording both copies', () => {
    const comment = { comment: { commentId: 'c1' } }
    const doc = legacyDoc(
      yRuns(['one '], ['two', comment]),
      yParagraph('filler'),
      yRuns(['copy', comment]),
      yParagraph('filler'),
      yRuns(['again', comment]),
    )

    const result = convert(stored(doc))

    expect(shown(openConverted(result.state), result.anchors.c1)).toEqual({
      from: 5,
      to: 8,
      text: 'two',
    })
    expect(result.dropped).toEqual([
      { kind: 'comment-copy', id: 'c1', text: 'copy' },
      { kind: 'comment-copy', id: 'c1', text: 'again' },
    ])
  })

  it.each([
    {
      name: 'Yjs',
      legacy: stored(legacyDoc(yMarked('see', { comment: { commentId: '__proto__' } }))),
    },
    {
      name: 'HTML',
      legacy: {
        content: null,
        html: '<p><span data-comment-id="__proto__">see</span></p>',
        collab: 0,
        ycomments: null,
      },
    },
  ])('refuses a comment whose id names the prototype, from $name', ({ legacy }) => {
    // Its anchor can't be kept under that key, so the comment would lose its thread
    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })
})
