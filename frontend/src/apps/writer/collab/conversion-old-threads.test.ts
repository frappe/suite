import { describe, expect, it } from 'vitest'
import { XmlText } from 'yjs'

import { convertLegacy } from '@/apps/writer/collab/conversion'
import {
  bodyOf,
  convert,
  DRIVE_THREAD,
  legacyDoc,
  MAX_STATE,
  openConverted,
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

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ANN = { userName: 'Ann', userImage: null, time: 1700000000000, content: 'see' }
const BO = { userName: 'Bo', userImage: null, time: 1700000060000, content: 'agreed' }
const SEEN = { content: '<p>see</p>', authorName: 'Ann', time: 1700000000000 }

function thread(uuid: string, ...comments: object[]) {
  return JSON.stringify({ uuid, comments })
}

function html(body: string) {
  return { content: null, html: body, collab: 0, ycomments: null }
}

// Each paragraph's words under a 2023 comment mark, as the old editor saved them
function markedHtml(...pieces: [string, string][]) {
  const blocks = pieces.map(([text, json]) => `<p><span data-comment='${json}'>${text}</span></p>`)
  return html(blocks.join(''))
}

// A code block, where the editor draws no marks, its words holding `attributes`
function yCode(text: string, attributes: Record<string, unknown>) {
  const content = new XmlText()
  content.insert(0, text, attributes)
  return yElement('codeBlock', content)
}

const REFUSED = { kind: 'failed', reason: 'check' }

describe("convertLegacy, Drive's 2023 threads", () => {
  it.each([
    {
      name: 'a Yjs body',
      legacy: stored(legacyDoc(yRuns(['one '], ['two', { comment: { comment: DRIVE_THREAD } }]))),
      from: 'yjs',
      dropped: [],
    },
    {
      name: 'HTML',
      legacy: html(`<p>one <span data-comment='${DRIVE_THREAD}'>two</span></p>`),
      from: 'html',
      dropped: [],
    },
    {
      name: 'the HTML read past a Yjs body holding nothing',
      legacy: {
        ...stored(legacyDoc(yElement('paragraph'))),
        html: `<p>one <span data-comment='${DRIVE_THREAD}'>two</span></p>`,
      },
      from: 'html',
      dropped: [{ kind: 'empty-yjs' }],
    },
  ])(
    'makes a thread of the comments a mark kept in $name, on its words',
    ({ legacy, from, dropped }) => {
      const result = convert(legacy)

      expect(result).toEqual({
        kind: 'converted',
        state: expect.any(Uint8Array),
        html: expect.any(String),
        dropped,
        from,
        anchors: {},
        threads: [{ key: expect.stringMatching(V4), anchor: expect.any(String), comments: [SEEN] }],
      })
      expect(shown(openConverted(result.state), result.threads[0].anchor)).toEqual({
        from: 5,
        to: 8,
        text: 'two',
      })
      expect(bodyOf(result.state)).toEqual(page(words('one two')))
      expect(storedRuns(result.state, 0)).toEqual([['one two', []]])
    },
  )

  it('makes a thread of a mark on a mention', () => {
    const mention = yAtom('mention', { id: 'x', label: 'Ann' })
    mention.setAttribute('comment', { comment: DRIVE_THREAD } as never)
    const legacy = stored(legacyDoc(yElement('paragraph', new XmlText('hi '), mention)))

    const result = convert(legacy)

    expect(result.threads.map(({ comments }) => comments)).toEqual([[SEEN]])
    expect(placeThread(openConverted(result.state).state, result.threads[0].anchor)).toEqual({
      kind: 'text',
      from: 4,
      to: 5,
      quote: '@Ann',
    })
    const shownMention = { type: 'mention', attrs: { id: 'x', label: 'Ann' } }
    expect(bodyOf(result.state)).toEqual(
      page(paragraph({ type: 'text', text: 'hi ' }, shownMention)),
    )
  })

  it('makes one thread of a mark split across runs by bold', () => {
    const mark = { comment: { comment: DRIVE_THREAD } }
    const runs = yRuns(['one ', mark], ['two', { ...mark, bold: {} }], [' three', mark])

    const result = convert(stored(legacyDoc(runs)))

    expect(result.threads.map(({ comments }) => comments)).toEqual([[SEEN]])
    expect(shown(openConverted(result.state), result.threads[0].anchor)).toEqual({
      from: 1,
      to: 14,
      text: 'one two three',
    })
    expect(storedRuns(result.state, 0)).toEqual([
      ['one ', []],
      ['two', ['bold']],
      [' three', []],
    ])
  })

  it.each([
    {
      name: 'Yjs',
      legacy: stored(
        legacyDoc(
          yMarked('one', { comment: { comment: thread('u1', ANN) } }),
          yMarked('two', { comment: { comment: thread('u1', ANN, BO) } }),
        ),
      ),
    },
    {
      name: 'HTML',
      legacy: markedHtml(['one', thread('u1', ANN)], ['two', thread('u1', ANN, BO)]),
    },
  ])(
    'keeps every comment of a thread whose reply rewrote only one of its two paragraphs, from $name',
    ({ legacy }) => {
      const result = convert(legacy)

      expect(result.threads.map(({ comments }) => comments)).toEqual([
        [
          { content: 'see', authorName: 'Ann', time: 1700000000000 },
          { content: 'agreed', authorName: 'Bo', time: 1700000060000 },
        ],
      ])
      expect(shown(openConverted(result.state), result.threads[0].anchor)).toEqual({
        from: 1,
        to: 9,
        text: 'onetwo',
      })
      expect(bodyOf(result.state)).toEqual(page(words('one'), words('two')))
    },
  )

  it.each([
    {
      name: 'Yjs',
      legacy: stored(
        legacyDoc(
          yMarked('one', { comment: { comment: thread('u1', ANN, BO) } }),
          yMarked('two', { comment: { comment: thread('u1', ANN, { ...BO, content: 'no' }) } }),
        ),
      ),
    },
    {
      name: 'HTML',
      legacy: markedHtml(
        ['one', thread('u1', ANN, BO)],
        ['two', thread('u1', ANN, { ...BO, content: 'no' })],
      ),
    },
  ])("refuses a thread whose marks' lists part ways, from $name", ({ legacy }) => {
    expect(convertLegacy(legacy, MAX_STATE)).toEqual(REFUSED)
  })

  it.each([
    {
      name: 'Yjs',
      legacy: stored(legacyDoc(yMarked('see', { comment: { comment: thread('u1') } }))),
    },
    { name: 'HTML', legacy: markedHtml(['see', thread('u1')]) },
    { name: 'blank HTML', legacy: html('<p><span data-comment=" ">see</span></p>') },
  ])('refuses a mark with no comments, from $name', ({ legacy }) => {
    expect(convertLegacy(legacy, MAX_STATE)).toEqual(REFUSED)
  })

  it.each([
    {
      name: 'a mark holding a thread id beside its thread',
      mark: { comment: { comment: DRIVE_THREAD, commentId: 'c1' } },
    },
    { name: 'a hashed copy of a mark', mark: { 'comment--a+/=bC9z': { comment: DRIVE_THREAD } } },
  ])('refuses $name', ({ mark }) => {
    expect(convertLegacy(stored(legacyDoc(yMarked('see', mark))), MAX_STATE)).toEqual(REFUSED)
  })

  it('anchors a thread whose mark sits in a code block, as a comment with a thread id there is', () => {
    const old = convert(stored(legacyDoc(yCode('see', { comment: { comment: DRIVE_THREAD } }))))
    const comment = convert(stored(legacyDoc(yCode('see', { comment: { commentId: 'c1' } }))))

    const places = [
      shown(openConverted(old.state), old.threads[0].anchor),
      shown(openConverted(comment.state), comment.anchors.c1),
    ]
    expect([old.threads[0].comments, places, old.dropped]).toEqual([
      [SEEN],
      [
        { from: 1, to: 4, text: 'see' },
        { from: 1, to: 4, text: 'see' },
      ],
      [],
    ])
  })

  it('refuses an HTML thread whose mark sits in a code block', () => {
    const legacy = html(`<pre><code><span data-comment='${DRIVE_THREAD}'>see</span></code></pre>`)

    expect(convertLegacy(legacy, MAX_STATE)).toEqual(REFUSED)
  })

  it.each([
    {
      name: 'an empty span',
      legacy: html(`<p>one <span data-comment='${DRIVE_THREAD}'></span></p>`),
    },
    {
      name: 'a span holding only a space the page drops',
      legacy: html(`<p>one <span data-comment='${DRIVE_THREAD}'> </span></p>`),
    },
    {
      name: 'a paragraph holding only a space',
      legacy: html(`<p><span data-comment='${DRIVE_THREAD}'> </span></p><p>two</p>`),
    },
  ])('refuses an HTML thread on $name, which leaves it no place', ({ legacy }) => {
    expect(convertLegacy(legacy, MAX_STATE)).toEqual(REFUSED)
  })

  it('refuses an HTML mark holding a thread id beside its thread', () => {
    const span = `<span data-comment='${DRIVE_THREAD}' data-comment-id="c1">see</span>`

    expect(convertLegacy(html(`<p>${span}</p>`), MAX_STATE)).toEqual(REFUSED)
  })

  it.each([
    {
      name: 'Yjs',
      legacy: stored(
        legacyDoc(
          yMarked('one', { comment: { comment: thread('u1', { ...ANN, userImage: '/a.png' }) } }),
          yMarked('two', { comment: { comment: thread('u2', { ...BO, userImage: '/b.png' }) } }),
        ),
      ),
    },
    {
      name: 'HTML',
      legacy: markedHtml(
        ['one', thread('u1', { ...ANN, userImage: '/a.png' })],
        ['two', thread('u2', { ...BO, userImage: '/b.png' })],
      ),
    },
  ])("records the comment writers' pictures once, from $name", ({ legacy }) => {
    const result = convert(legacy)

    expect([result.threads.length, result.dropped]).toEqual([
      2,
      [{ kind: 'noise', name: 'userImage' }],
    ])
  })

  it("records a far copy of a thread's mark under the thread's key", () => {
    const mark = { comment: { comment: DRIVE_THREAD } }
    const doc = legacyDoc(
      yRuns(['one '], ['two', mark]),
      yParagraph('filler'),
      yMarked('copy', mark),
    )

    const result = convert(stored(doc))

    const [{ key, anchor }] = result.threads
    expect(shown(openConverted(result.state), anchor)).toEqual({ from: 5, to: 8, text: 'two' })
    expect(result.dropped).toEqual([{ kind: 'comment-copy', id: key, text: 'copy' }])
  })

  it('keeps a thread beside a comment that carries its thread id apart', () => {
    const legacy = stored(
      legacyDoc(
        yRuns(
          ['one', { comment: { commentId: 'c1' } }],
          [' '],
          ['two', { comment: { comment: DRIVE_THREAD } }],
        ),
      ),
    )

    const result = convert(legacy)

    const editor = openConverted(result.state)
    expect(Object.keys(result.anchors)).toEqual(['c1'])
    expect(shown(editor, result.anchors.c1)).toEqual({ from: 1, to: 4, text: 'one' })
    expect(result.threads.map(({ comments }) => comments)).toEqual([[SEEN]])
    expect(shown(editor, result.threads[0].anchor)).toEqual({ from: 5, to: 8, text: 'two' })
  })
})
