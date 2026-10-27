import { generateJSON, type JSONContent } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import { Doc, encodeStateAsUpdate, encodeStateVector, mergeUpdates, XmlElement, XmlText } from 'yjs'

import { writerAdapter } from '@/apps/writer/collab/adapter'
import { convertLegacy } from '@/apps/writer/collab/conversion'
import { BODY_FIELD } from '@/apps/writer/collab/field'
import { addInnerText } from '@/apps/writer/collab/headless-dom'
import {
  bodyOf,
  convert,
  drawnIds,
  headingIds,
  legacyDoc,
  MAX_STATE,
  oldMedia,
  openConverted,
  opened,
  page,
  paragraph,
  SRC,
  stored,
  toBase64,
  withChildren,
  words,
  yAtom,
  yElement,
  yHeading,
  yMarked,
  yParagraph,
} from '@/apps/writer/collab/legacy-fixtures'
import { convertOldMedia } from '@/apps/writer/collab/old-media'

// The binding never writes a null attribute; this covers hand-written or foreign data, which the
// inventory reads as unset
const UNSET = null as unknown as string
// Old Drive's page break as its editor wrote it, its data attribute aside
const DRIVE_PAGE_BREAK =
  'id="page-break-div" style="page-break-after: always; border: 2px dashed lightgray; margin: 25px 0px;"'

vi.mock('@tiptap/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tiptap/core')>()
  return { ...original, generateJSON: vi.fn(original.generateJSON) }
})

vi.mock('@/apps/writer/collab/old-media', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/apps/writer/collab/old-media')>()
  return { ...original, convertOldMedia: vi.fn(original.convertOldMedia) }
})

describe('convertLegacy', () => {
  it('keeps old images and videos, a video opening a list item after an empty paragraph', () => {
    const video = { src: '/files/demo.mp4', 'media-type': 'video', dataAlign: 'center' }
    const item = yElement('listItem', oldMedia(video))
    const doc = legacyDoc(
      yParagraph('before'),
      oldMedia({ src: SRC, 'media-type': 'img', alt: 'Sales chart' }),
      yElement('bulletList', item),
    )

    const result = convert(stored(doc))

    const shownVideo = { type: 'video', attrs: { src: '/files/demo.mp4', align: 'center' } }
    const list = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(), shownVideo] }],
    }
    const image = { type: 'image', attrs: { src: SRC, alt: 'Sales chart', align: 'left' } }
    expect(bodyOf(result.state)).toEqual(page(words('before'), paragraph(image), list))
    expect(result.dropped).toEqual([])
    expect(result.from).toBe('yjs')
  })

  it("keeps Drive's top-level block image in a paragraph with all it stored (R332)", () => {
    const attrs = { src: SRC, alt: 'Sales chart', title: 'Q3', caption: 'Revenue' }
    const doc = legacyDoc(yParagraph('one'), yAtom('image', attrs))

    const result = convert(stored(doc))

    const image = { type: 'image', attrs: { ...attrs, align: 'left' } }
    const body = page(words('one'), paragraph(image))
    expect([bodyOf(result.state), result.dropped]).toEqual([body, []])
  })

  it("keeps Drive's block image after a list item's paragraph, in a paragraph there", () => {
    const item = yElement('listItem', yParagraph('item'), yAtom('image', { src: SRC }))

    const result = convert(stored(legacyDoc(yElement('bulletList', item))))

    const image = { type: 'image', attrs: { src: SRC, align: 'left' } }
    const list = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [words('item'), paragraph(image)] }],
    }
    expect([bodyOf(result.state), result.dropped]).toEqual([page(list), []])
  })

  it('keeps a top-level video as a block', () => {
    const doc = legacyDoc(yParagraph('one'), yAtom('video', { src: '/files/demo.mp4' }))

    const result = convert(stored(doc))

    const video = { type: 'video', attrs: { src: '/files/demo.mp4' } }
    expect([bodyOf(result.state), result.dropped]).toEqual([page(words('one'), video), []])
  })

  it("drops the upload id frappe-ui left on Drive's block image and records it", () => {
    const attrs = { src: SRC, uploadId: 'u1', alt: 'Sales chart', title: 'Q3' }
    const doc = legacyDoc(yParagraph('one'), yAtom('image', attrs))

    const result = convert(stored(doc))

    const image = {
      type: 'image',
      attrs: { src: SRC, alt: 'Sales chart', title: 'Q3', align: 'left' },
    }
    const body = page(words('one'), paragraph(image))
    expect([bodyOf(result.state), result.dropped]).toEqual([
      body,
      [{ kind: 'noise', name: 'uploadId' }],
    ])
  })

  it.each([
    {
      name: 'an image in a paragraph',
      doc: () => legacyDoc(yElement('paragraph', yAtom('image', { src: SRC, uploadId: 'u1' }))),
      body: page(paragraph({ type: 'image', attrs: { src: SRC } })),
    },
    {
      name: 'a video',
      doc: () => legacyDoc(yAtom('video', { src: '/files/demo.mp4', uploadId: 'u1' })),
      body: page({ type: 'video', attrs: { src: '/files/demo.mp4' } }),
    },
    {
      name: 'two images, recorded once',
      doc: () =>
        legacyDoc(
          yElement('paragraph', yAtom('image', { src: SRC, uploadId: 'u1' })),
          yElement('paragraph', yAtom('image', { src: SRC, uploadId: 'u2' })),
        ),
      body: page(
        paragraph({ type: 'image', attrs: { src: SRC } }),
        paragraph({ type: 'image', attrs: { src: SRC } }),
      ),
    },
  ])('drops the upload id frappe-ui left on $name and records it', ({ doc, body }) => {
    const result = convert(stored(doc()))

    expect([bodyOf(result.state), result.dropped]).toEqual([
      body,
      [{ kind: 'noise', name: 'uploadId' }],
    ])
  })

  it.each([
    {
      name: 'on an image',
      doc: () =>
        legacyDoc(
          yElement('paragraph', yAtom('image', { src: SRC, error: 'Failed to upload image' })),
        ),
      body: page(
        paragraph({ type: 'image', attrs: { src: SRC, error: 'Failed to upload image' } }),
      ),
      dropped: [],
    },
    {
      name: 'on a video',
      doc: () => legacyDoc(yAtom('video', { src: '/files/demo.mp4', error: 'true' })),
      body: page({ type: 'video', attrs: { src: '/files/demo.mp4', error: 'true' } }),
      dropped: [],
    },
    {
      name: 'beside an upload id, which alone drops',
      doc: () =>
        legacyDoc(
          yElement('paragraph', yAtom('image', { src: SRC, uploadId: 'u1', error: 'true' })),
        ),
      body: page(paragraph({ type: 'image', attrs: { src: SRC, error: 'true' } })),
      dropped: [{ kind: 'noise', name: 'uploadId' }],
    },
  ])('keeps the upload error people saw $name', ({ doc, body, dropped }) => {
    const result = convert(stored(doc()))

    expect([bodyOf(result.state), result.dropped]).toEqual([body, dropped])
  })

  it.each([
    { name: 'a kind it never wrote', stored: { 'media-type': 'audio' } },
    { name: 'an alignment outside its three', stored: { dataAlign: 'justify' } },
    { name: 'a float outside its two', stored: { dataFloat: 'center' } },
    { name: 'a width neither pixels nor its default', stored: { width: '50%' } },
    { name: 'a height neither pixels nor its default', stored: { height: '20%' } },
    { name: 'a pixel height without a pixel width', stored: { width: '100%', height: 200 } },
    { name: 'a negative pixel width', stored: { width: -5 } },
    { name: 'a negative pixel height', stored: { width: 320, height: -5 } },
    { name: 'an attribute it never declared', stored: { foo: '1' } },
  ])("refuses the old editor's resizable media holding $name", ({ stored: attrs }) => {
    const doc = legacyDoc(yParagraph('one'), oldMedia({ src: SRC, 'media-type': 'img', ...attrs }))

    expect(convertLegacy(stored(doc), MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each([
    {
      name: 'a resized image',
      attrs: { 'media-type': 'img', width: 320, height: 180, dataAlign: 'right' },
      shown: paragraph({
        type: 'image',
        attrs: { src: SRC, width: 320, height: 180, align: 'right' },
      }),
    },
    {
      name: 'a resized image with a height of NaN',
      attrs: { 'media-type': 'img', width: 420, height: Number.NaN },
      shown: paragraph({ type: 'image', attrs: { src: SRC, width: 420, align: 'left' } }),
    },
    {
      name: 'a resized image with a height of Infinity',
      attrs: { 'media-type': 'img', width: 420, height: Number.POSITIVE_INFINITY },
      shown: paragraph({ type: 'image', attrs: { src: SRC, width: 420, align: 'left' } }),
    },
    {
      name: 'an image at its defaults',
      attrs: { 'media-type': 'img', width: '100%', height: 'auto' },
      shown: paragraph({ type: 'image', attrs: { src: SRC, align: 'left' } }),
    },
    {
      name: 'a video',
      attrs: { 'media-type': 'video', width: '100%', height: 'auto', dataFloat: 'left' },
      shown: { type: 'video', attrs: { src: SRC, align: 'left', float: 'left' } },
    },
    {
      name: 'no kind, as an image',
      attrs: {},
      shown: paragraph({ type: 'image', attrs: { src: SRC, align: 'left' } }),
    },
  ])("keeps the old editor's resizable media: $name", ({ attrs, shown }) => {
    const result = convert(stored(legacyDoc(yParagraph('one'), oldMedia({ src: SRC, ...attrs }))))

    expect([bodyOf(result.state), result.dropped]).toEqual([page(words('one'), shown), []])
  })

  it("keeps the old editor's alignment over its float, recording the float once", () => {
    const both = { src: SRC, 'media-type': 'img', dataAlign: 'center', dataFloat: 'right' }
    const doc = legacyDoc(yParagraph('one'), oldMedia(both), oldMedia(both))
    const result = convert(stored(doc))

    const shown = paragraph({ type: 'image', attrs: { src: SRC, align: 'center' } })
    expect([bodyOf(result.state), result.dropped]).toEqual([
      page(words('one'), shown, shown),
      [{ kind: 'noise', name: 'dataFloat' }],
    ])
  })

  it("leaves an upload id on a part that isn't media to the check, which refuses it", () => {
    const part = yParagraph('one')
    part.setAttribute('uploadId', 'u1')

    expect(convertLegacy(stored(legacyDoc(part)), MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("drops Drive's table of contents with its stored hint and records it (R341)", () => {
    const toc = yAtom('tocNode', { placeholder: 'Table of Contents' })
    const doc = legacyDoc(yParagraph('one'), toc, yParagraph('two'))

    const result = convert(stored(doc))

    expect(bodyOf(result.state)).toEqual(page(words('one'), words('two')))
    expect(result.dropped).toEqual([{ kind: 'toc-hint' }])
  })

  it("drops Drive's table of contents holding a null attribute beside its hint and records it (R484)", () => {
    const toc = yAtom('tocNode', { placeholder: 'Table of Contents' })
    toc.setAttribute('title', UNSET)
    const doc = legacyDoc(yParagraph('one'), toc, yParagraph('two'))

    const result = convert(stored(doc))

    expect(bodyOf(result.state)).toEqual(page(words('one'), words('two')))
    expect(result.dropped).toEqual([{ kind: 'toc-hint' }])
  })

  it.each([
    {
      name: 'another attribute',
      toc: () => yAtom('tocNode', { placeholder: 'Table of Contents', title: 'x' }),
    },
    {
      name: 'text',
      toc: () => {
        const toc = yElement('tocNode', new XmlText('Intro'))
        toc.setAttribute('placeholder', 'Table of Contents')
        return toc
      },
    },
    {
      name: 'a horizontal rule',
      toc: () => {
        const toc = yElement('tocNode', new XmlElement('horizontalRule'))
        toc.setAttribute('placeholder', 'Table of Contents')
        return toc
      },
    },
    {
      name: 'a paragraph with an attribute',
      toc: () => {
        const toc = yElement('tocNode', yAtom('paragraph', { textAlign: 'center' }))
        toc.setAttribute('placeholder', 'Table of Contents')
        return toc
      },
    },
  ])("refuses Drive's table of contents holding $name besides its hint (R346)", ({ toc }) => {
    const legacy = stored(legacyDoc(yParagraph('one'), toc(), yParagraph('two')))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('converts a body holding an empty list, which the editor hides, and records it', () => {
    const doc = legacyDoc(yParagraph('one'), new XmlElement('bulletList'))

    const result = convert(stored(doc))

    expect([bodyOf(result.state), result.dropped]).toEqual([
      page(words('one')),
      [{ kind: 'empty', name: 'bulletList' }],
    ])
  })

  it('converts a body holding an empty part the editor cannot hold, and records it (R438)', () => {
    const doc = legacyDoc(yParagraph('one'), new XmlElement('callout'))

    const result = convert(stored(doc))

    expect([bodyOf(result.state), result.dropped]).toEqual([
      page(words('one')),
      [{ kind: 'empty', name: 'callout' }],
    ])
  })

  it('converts a body holding a part the editor cannot hold whose only attribute is null, and records it (R484)', () => {
    const callout = new XmlElement('callout')
    callout.setAttribute('kind', UNSET)
    const doc = legacyDoc(yParagraph('one'), callout)

    const result = convert(stored(doc))

    expect([bodyOf(result.state), result.dropped]).toEqual([
      page(words('one')),
      [{ kind: 'empty', name: 'callout' }],
    ])
  })

  it('refuses a part the editor cannot hold that holds text (R316)', () => {
    const legacy = stored(legacyDoc(yParagraph('one'), yElement('callout', yParagraph('note'))))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses text the editor has no place for, with no part around it (R484)', () => {
    const doc = legacyDoc(yParagraph('one'))
    doc.getXmlFragment(BODY_FIELD).insert(1, [new XmlText('stray')])

    expect(convertLegacy(stored(doc), MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each([
    { name: 'in a paragraph', inside: () => yElement('paragraph', yAtom('image', { src: SRC })) },
    { name: 'directly', inside: () => yAtom('image', { src: SRC }) },
  ])('refuses a part the editor cannot hold that has an image in it $name (R316)', ({ inside }) => {
    const legacy = stored(legacyDoc(yParagraph('one'), yElement('callout', inside())))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each([
    {
      name: 'a list',
      outer: () =>
        yElement(
          'bulletList',
          yElement('listItem', yParagraph('item')),
          yAtom('image', { src: SRC }),
        ),
    },
    {
      name: 'a table row',
      outer: () => yElement('table', yElement('tableRow', yAtom('image', { src: SRC }))),
    },
  ])(
    'refuses a block image directly in $name, where no paragraph can hold it (R344)',
    ({ outer }) => {
      const legacy = stored(legacyDoc(yParagraph('one'), outer()))

      expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
    },
  )

  it('refuses a part the editor cannot hold that stores an attribute', () => {
    const legacy = stored(legacyDoc(yParagraph('one'), yAtom('callout', { kind: 'note' })))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('records text Yjs holds back because the change it follows was never stored', () => {
    const writer = new Doc()
    const text = new XmlText('first')
    writer.getXmlFragment(BODY_FIELD).insert(0, [yElement('paragraph', text)])
    const before = encodeStateVector(writer)
    text.insert(5, ' second')
    const later = encodeStateAsUpdate(writer, before)
    const other = legacyDoc(yParagraph('kept'))
    const content = toBase64(mergeUpdates([encodeStateAsUpdate(other), later]))

    const result = convert({ content, html: '', collab: 1, ycomments: null })

    expect(bodyOf(result.state)).toEqual(page(words('kept')))
    expect(result.dropped).toEqual([{ kind: 'pending', text: ' second', parts: [] }])
  })

  it('records a held-back change that adds a part and no text', () => {
    const writer = legacyDoc(yParagraph('first'))
    const before = encodeStateVector(writer)
    writer.getXmlFragment(BODY_FIELD).insert(1, [new XmlElement('pageBreak')])
    const later = encodeStateAsUpdate(writer, before)
    const other = legacyDoc(yParagraph('kept'))
    const content = toBase64(mergeUpdates([encodeStateAsUpdate(other), later]))

    const result = convert({ content, html: '', collab: 1, ycomments: null })

    expect(result.dropped).toEqual([{ kind: 'pending', text: '', parts: ['pageBreak'] }])
  })

  it('holds only the body, leaving the old users, docinfo and emptied annotations behind', () => {
    const doc = legacyDoc(yParagraph('one'))
    doc.getMap('users').set('a', 'Ann')
    doc.getMap('docinfo').set('title', 'Old')
    doc.getArray('docAnnotations').insert(0, ['note'])
    doc.getArray('docAnnotations').delete(0, 1)

    const result = convert(stored(doc))

    expect([...opened(result.state).share.keys()]).toEqual([BODY_FIELD])
  })

  it('converts a document saved without collaboration from its HTML', () => {
    const legacy = { ...stored(legacyDoc(yParagraph('stale'))), html: '<p>fresh</p>', collab: 0 }

    const result = convert(legacy)

    expect(bodyOf(result.state)).toEqual(page(words('fresh')))
    expect(result.from).toBe('html')
  })

  it('answers the readable copy a live tab writes, its tabs in the order stored', () => {
    function tab(id: string, order: string, text: string) {
      const node = yElement('tab', yParagraph(text))
      node.setAttribute('id', id)
      node.setAttribute('label', id)
      node.setAttribute('order', order)
      return node
    }

    const legacy = stored(
      legacyDoc(yParagraph('first'), tab('b', '2', 'two'), tab('a', '1', 'one')),
    )

    const result = convert(legacy)

    expect(result.html).toBe(writerAdapter.toHtml?.(opened(result.state)))
  })

  it.each([
    { name: 'no', content: null },
    { name: 'empty', content: '' },
  ])(
    'converts from the HTML, recording nothing, when a collaborative row stores $name Yjs bytes',
    ({ content }) => {
      const result = convert({ content, html: '<p>fresh</p>', collab: 1, ycomments: null })

      expect(bodyOf(result.state)).toEqual(page(words('fresh')))
      expect([result.from, result.dropped]).toEqual(['html', []])
    },
  )

  it.each([
    { name: 'Yjs cannot read', content: btoa('\u0005broken') },
    { name: 'are not base64', content: 'not base64!' },
  ])('refuses, rather than reading the HTML, stored bytes that $name (R434)', ({ content }) => {
    const legacy = { content, html: '<p>fresh</p>', collab: 1, ycomments: null }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'unreadable-yjs' })
  })

  it('converts from the HTML when the stored Yjs document holds no changes, and records it', () => {
    const legacy = {
      content: toBase64(encodeStateAsUpdate(new Doc())),
      html: '<p>typed later</p>',
      collab: 1,
      ycomments: null,
    }

    const result = convert(legacy)

    expect(bodyOf(result.state)).toEqual(page(words('typed later')))
    expect([result.from, result.dropped]).toEqual(['html', [{ kind: 'empty-yjs' }]])
  })

  it('converts from the HTML when the Yjs body holds no words or parts, and records it (R317)', () => {
    const toc = yAtom('tocNode', { placeholder: 'Table of Contents' })
    const doc = legacyDoc(yElement('paragraph'), yHeading(''), toc, yParagraph(''))
    const legacy = { ...stored(doc), html: '<p>typed later</p>' }

    const result = convert(legacy)

    expect(bodyOf(result.state)).toEqual(page(words('typed later')))
    expect([result.from, result.dropped]).toEqual(['html', [{ kind: 'empty-yjs' }]])
  })

  it('converts from the HTML when the Yjs body holds only a list of empty items', () => {
    const list = yElement('bulletList', yElement('listItem', yElement('paragraph')))
    const legacy = { ...stored(legacyDoc(list)), html: '<p>typed later</p>' }

    const result = convert(legacy)

    expect(bodyOf(result.state)).toEqual(page(words('typed later')))
    expect([result.from, result.dropped]).toEqual(['html', [{ kind: 'empty-yjs' }]])
  })

  it.each([
    { name: 'words', block: () => yParagraph('typed') },
    { name: 'a part', block: () => new XmlElement('horizontalRule') },
    {
      name: 'an image with a stray child',
      block: () => yElement('paragraph', withChildren(yAtom('image', { src: SRC }), new XmlText())),
    },
    {
      name: 'old media with a stray paragraph',
      block: () => withChildren(oldMedia({ src: SRC }), yElement('paragraph')),
    },
    {
      name: 'a mention with a stray child',
      block: () =>
        yElement('paragraph', withChildren(yAtom('mention', { id: 'x' }), new XmlText())),
    },
  ])('converts from a Yjs body holding $name, not the HTML', ({ block }) => {
    const legacy = { ...stored(legacyDoc(yElement('paragraph'), block())), html: '<p>older</p>' }

    const result = convert(legacy)

    expect(result.from).toBe('yjs')
    expect(JSON.stringify(bodyOf(result.state))).not.toContain('older')
  })

  it('refuses the HTML over a Yjs body holding nothing whose annotations list holds threads', () => {
    const doc = legacyDoc(yElement('paragraph'))
    doc.getArray('docAnnotations').insert(0, [{ id: 'a1' }])
    const legacy = { ...stored(doc), html: '<p>typed later</p>' }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('records text Yjs holds back in a body holding nothing read past for the HTML', () => {
    const writer = new Doc()
    const text = new XmlText()
    writer.getXmlFragment(BODY_FIELD).insert(0, [yElement('paragraph', text)])
    const before = encodeStateVector(writer)
    text.insert(0, 'held')
    const later = encodeStateAsUpdate(writer, before)
    const other = legacyDoc(yElement('paragraph'))
    const content = toBase64(mergeUpdates([encodeStateAsUpdate(other), later]))

    const result = convert({ content, html: '<p>typed later</p>', collab: 1, ycomments: null })

    expect(bodyOf(result.state)).toEqual(page(words('typed later')))
    expect(result.dropped).toEqual([
      { kind: 'empty-yjs' },
      { kind: 'pending', text: 'held', parts: [] },
    ])
  })

  it('gives headings the ids the editor draws for them today and keeps ids they had', () => {
    const doc = legacyDoc(
      yHeading('Intro'),
      yParagraph('body'),
      yHeading('Intro'),
      yHeading('Plan', 'kept-id'),
      yHeading(''),
    )
    const drawn = drawnIds(doc)

    const result = convert(stored(doc))

    expect(drawn[0]).toBeTruthy()
    expect(drawn[1]).toBeTruthy()
    expect(drawn[0]).not.toBe(drawn[1])
    expect(headingIds(result.state)).toEqual([drawn[0], drawn[1], 'kept-id', null])
  })

  it('changes nothing when a converted body is converted again', () => {
    const doc = legacyDoc(
      yHeading('Intro'),
      oldMedia({ src: SRC, 'media-type': 'img' }),
      new XmlElement('tocNode'),
    )
    const first = convert(stored(doc))

    const second = convert({ content: toBase64(first.state), html: '', collab: 1, ycomments: null })

    expect(bodyOf(second.state)).toEqual(bodyOf(first.state))
    expect(second.dropped).toEqual([])
  })

  it('refuses a body over the size cap', () => {
    const result = convertLegacy(stored(legacyDoc(yParagraph('one'))), 10)

    expect(result).toEqual({ kind: 'failed', reason: 'too_large' })
  })

  it('refuses a body that would lose text it does not record', () => {
    const legacy = {
      content: null,
      html: '<p>kept</p><script>gone()</script>',
      collab: 0,
      ycomments: null,
    }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('fails rather than falling back to the HTML when readable bytes break the conversion', () => {
    vi.mocked(convertOldMedia).mockImplementationOnce(() => {
      throw new Error('conversion bug')
    })
    const legacy = { ...stored(legacyDoc(yParagraph('typed'))), html: '<p>older</p>' }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses, rather than throwing, an old body the editor cannot read', () => {
    vi.mocked(generateJSON).mockImplementationOnce(() => {
      throw new TypeError('unreadable')
    })
    const legacy = { content: null, html: '<p>one</p>', collab: 0, ycomments: null }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('keeps a tag saved in the HTML with no label, reading its label from its words', () => {
    addInnerText(window)
    const legacy = {
      content: null,
      html: '<p><span class="tag-item">#plan</span></p>',
      collab: 0,
      ycomments: null,
    }

    const result = convert(legacy)

    const tag = { type: 'tagItem', attrs: { tagId: null, tagLabel: 'plan' } }
    expect(bodyOf(result.state)).toEqual(page(paragraph(tag)))
    expect(result.dropped).toEqual([])
  })

  it('keeps a mention saved in the HTML, its words matching its label', () => {
    const mention =
      '<span class="mention" data-type="mention" data-id="x" data-label="Ann">@Ann</span>'
    const legacy = { content: null, html: `<p>hi ${mention}</p>`, collab: 0, ycomments: null }

    const result = convert(legacy)

    const shownMention = { type: 'mention', attrs: { id: 'x', label: 'Ann' } }
    expect(bodyOf(result.state)).toEqual(
      page(paragraph({ type: 'text', text: 'hi ' }, shownMention)),
    )
    expect(result.dropped).toEqual([])
  })

  it('keeps a mention stored in the Yjs body', () => {
    const mention = new XmlElement('mention')
    mention.setAttribute('id', 'x')
    mention.setAttribute('label', 'Ann')
    const doc = legacyDoc(yElement('paragraph', new XmlText('hi '), mention))

    const result = convert(stored(doc))

    const shownMention = { type: 'mention', attrs: { id: 'x', label: 'Ann' } }
    expect(bodyOf(result.state)).toEqual(
      page(paragraph({ type: 'text', text: 'hi ' }, shownMention)),
    )
    expect(result.dropped).toEqual([])
  })

  it("drops the author and kind Drive's mentions stored, never drawn, recording each once", () => {
    const doc = legacyDoc(
      yElement(
        'paragraph',
        yAtom('mention', { id: 'x', label: 'Ann', author: 'a@b.c', type: 'user' }),
        yAtom('mention', { id: 'y', label: 'Bo', author: 'a@b.c' }),
      ),
    )

    const result = convert(stored(doc))

    expect([bodyOf(result.state), result.dropped]).toEqual([
      page(
        paragraph(
          { type: 'mention', attrs: { id: 'x', label: 'Ann' } },
          { type: 'mention', attrs: { id: 'y', label: 'Bo' } },
        ),
      ),
      [
        { kind: 'noise', name: 'author' },
        { kind: 'noise', name: 'type' },
      ],
    ])
  })

  it.each([
    {
      name: 'image',
      doc: () => legacyDoc(yElement('paragraph', yAtom('image', { src: SRC, 'data-node': 'x' }))),
    },
    {
      name: 'mention',
      doc: () =>
        legacyDoc(yElement('paragraph', yAtom('mention', { id: 'x', label: 'A', uploadId: 'u1' }))),
    },
    {
      name: 'mention with an inherited key',
      doc: () =>
        legacyDoc(
          yElement('paragraph', yAtom('mention', { id: 'x', label: 'A', constructor: 'x' })),
        ),
    },
    { name: 'horizontal rule', doc: () => legacyDoc(yAtom('horizontalRule', { colour: 'red' })) },
  ])('refuses an old Yjs $name holding a key Writer does not declare', ({ doc }) => {
    expect(convertLegacy(stored(doc()), MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('keeps an old Yjs mention whose bold is stored under an overlap suffix', () => {
    const mention = yAtom('mention', { id: 'x', label: 'A' })
    mention.setAttribute('bold--abcd1234', {} as never)
    const legacy = stored(legacyDoc(yElement('paragraph', mention)))

    const result = convert(legacy)

    const shownMention = openConverted(result.state).state.doc.firstChild!.child(0)
    expect(shownMention.marks.map((mark) => mark.toJSON())).toEqual([{ type: 'bold' }])
  })

  it('keeps an old Yjs image whose undeclared key is unset', () => {
    const doc = legacyDoc(yElement('paragraph', yAtom('image', { src: SRC, 'data-node': UNSET })))

    const result = convert(stored(doc))

    expect(bodyOf(result.state)).toEqual(page(paragraph({ type: 'image', attrs: { src: SRC } })))
  })

  it("drops the author Drive's HTML mentions held, never drawn, recording it once", () => {
    const ann =
      '<span class="mention" data-type="mention" data-id="x" data-label="Ann" data-author="a@b.c">@Ann</span>'
    const bo =
      '<span class="mention" data-type="mention" data-id="y" data-label="Bo" data-author="a@b.c">@Bo</span>'
    const html = `<p>${ann} ${bo}</p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    expect([bodyOf(result.state), result.dropped]).toEqual([
      page(
        paragraph(
          { type: 'mention', attrs: { id: 'x', label: 'Ann' } },
          { type: 'text', text: ' ' },
          { type: 'mention', attrs: { id: 'y', label: 'Bo' } },
        ),
      ),
      [{ kind: 'noise', name: 'author' }],
    ])
  })

  it.each(['User', 'User Group'])(
    "keeps old Drive's HTML mention of a %s as a mention, recording its type and author",
    (type) => {
      const mention = `<span data-type="${type}" class="mention" data-id="x" data-label="Ann" data-author="a@b.c">@Ann</span>`
      const html = `<p>hi ${mention}</p>`

      const result = convert({ content: null, html, collab: 0, ycomments: null })

      expect(bodyOf(result.state)).toEqual(
        page(
          paragraph(
            { type: 'text', text: 'hi ' },
            { type: 'mention', attrs: { id: 'x', label: 'Ann' } },
          ),
        ),
      )
      expect(result.dropped).toHaveLength(2)
      expect(result.dropped).toEqual(
        expect.arrayContaining([
          { kind: 'noise', name: 'type' },
          { kind: 'noise', name: 'author' },
        ]),
      )
    },
  )

  it.each([
    {
      name: 'no id',
      mention: '<span data-type="User" class="mention" data-label="Ann">@Ann</span>',
    },
    {
      name: 'no type',
      mention: '<span class="mention" data-id="x" data-label="Ann">@Ann</span>',
    },
    {
      name: 'another type',
      mention: '<span data-type="Team" class="mention" data-id="x" data-label="Ann">@Ann</span>',
    },
  ])("refuses old Drive's HTML mention with $name", ({ mention }) => {
    const html = `<p>hi ${mention}</p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it("keeps Drive's HTML page break, its id and look going since the editor draws the same", () => {
    const html = `<p>one</p><div ${DRIVE_PAGE_BREAK} data-page-break="true"></div><p>two</p>`

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    expect([bodyOf(result.state), result.dropped]).toEqual([
      page(words('one'), { type: 'pageBreak' }, words('two')),
      [],
    ])
  })

  it.each([
    { name: 'another look', attributes: DRIVE_PAGE_BREAK.replace('lightgray', 'red') },
    {
      name: "more than Drive's look",
      attributes: DRIVE_PAGE_BREAK.replace('0px;', '0px; color: red;'),
    },
    { name: 'another id', attributes: DRIVE_PAGE_BREAK.replace('page-break-div', 'x') },
    {
      name: "Drive's look and no id",
      attributes: DRIVE_PAGE_BREAK.replace('id="page-break-div" ', ''),
    },
    { name: "Drive's id and no look", attributes: 'id="page-break-div"' },
  ])('refuses an HTML page break holding $name', ({ attributes }) => {
    const html = `<p>one</p><div ${attributes} data-page-break="true"></div><p>two</p>`

    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it.each([
    { name: 'a span', html: '<p><span data-author="a@b.c">hi</span></p>' },
    { name: 'a paragraph', html: '<p data-author="a@b.c">hi</p>' },
    { name: 'a link', html: '<p><a href="/a" data-author="a@b.c">hi</a></p>' },
  ])('refuses an author on $name, only mentions dropping theirs', ({ html }) => {
    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('keeps a heading holding a non-breaking space and a line break', () => {
    const legacy = {
      content: null,
      html: '<h2>Big&nbsp;plan<br>today</h2>',
      collab: 0,
      ycomments: null,
    }

    const result = convert(legacy)

    const [heading] = bodyOf(result.state).content
    expect(heading.content).toEqual([
      { type: 'text', text: 'Big\u00a0plan' },
      { type: 'hardBreak' },
      { type: 'text', text: 'today' },
    ])
  })

  it('keeps an image saved in the HTML', () => {
    const legacy = {
      content: null,
      html: `<p>one</p><p><img src="${SRC}"></p>`,
      collab: 0,
      ycomments: null,
    }

    const result = convert(legacy)

    // The image rule reads a missing alignment as left, as the old editor showed it
    const image = { type: 'image', attrs: { src: SRC, align: 'left' } }
    expect(bodyOf(result.state)).toEqual(page(words('one'), paragraph(image)))
  })

  it('refuses HTML whose parse leaves out an image, which changes no text', () => {
    vi.mocked(generateJSON).mockImplementationOnce(() => ({ type: 'doc', content: [words('one')] }))
    const legacy = {
      content: null,
      html: `<p>one</p><p><img src="${SRC}"></p>`,
      collab: 0,
      ycomments: null,
    }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('refuses HTML holding media the editor has no place for', () => {
    const legacy = {
      content: null,
      html: '<p>a</p><iframe src="x"></iframe>',
      collab: 0,
      ycomments: null,
    }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it.each([
    { name: 'video', html: '<video controls><source src="/v.mp4"></video>' },
    { name: 'attachment', html: '<p><a data-attachment href="/f">Quarterly report.pdf</a></p>' },
    {
      name: 'mention',
      html:
        '<p><span class="mention" data-type="mention" data-id="x" data-label="Ann">' +
        '@Ann and Bob</span></p>',
    },
    { name: 'video fallback', html: `<video src="/v.mp4">Can't play</video>` },
  ])("refuses HTML whose $name holds what the editor wouldn't draw", ({ html }) => {
    const legacy = { content: null, html, collab: 0, ycomments: null }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('keeps a Drive video whose source repeats its src', () => {
    const html = '<video src="/v.mp4" controls><source src="/v.mp4" type="video/mp4"></video>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const media = bodyOf(result.state).content.map(({ type, attrs }: JSONContent) => [
      type,
      attrs?.src,
    ])
    expect(media).toEqual([['video', '/v.mp4']])
  })

  it("draws the old editor's alignment over its float, recording the float once", () => {
    const layout = 'dataalign="center" datafloat="right"'
    const image = `<img src="${SRC}" media-type="img" width="100%" height="auto" ${layout}>`
    const result = convert({
      content: null,
      html: `<p>${image}</p><p>${image}</p>`,
      collab: 0,
      ycomments: null,
    })

    const element = document.createElement('div')
    element.innerHTML = openConverted(result.state).getHTML()
    const media = [...element.querySelectorAll('img')].map((shown) => ({
      align: shown.getAttribute('data-align'),
      float: shown.getAttribute('data-float'),
      width: shown.getAttribute('width'),
      height: shown.getAttribute('height'),
    }))
    const drawn = { align: 'center', float: null, width: '100%', height: 'auto' }
    expect([media, result.dropped]).toEqual([
      [drawn, drawn],
      [{ kind: 'noise', name: 'datafloat' }],
    ])
  })

  it.each([
    {
      name: 'a float with no alignment',
      html: `<p><img src="${SRC}" media-type="img" datafloat="right"></p>`,
      drawn: { tag: 'img', align: 'left', float: 'right', width: null, height: null },
    },
    {
      name: 'neither, at the left',
      html: `<p><img src="${SRC}" media-type="img"></p>`,
      drawn: { tag: 'img', align: 'left', float: null, width: null, height: null },
    },
    {
      name: 'a video with neither, at the left',
      html: '<video src="/v.mp4" controls="true" media-type="video" width="100%" height="auto"></video>',
      drawn: { tag: 'video', align: 'left', float: null, width: '100%', height: 'auto' },
    },
  ])("draws the old editor's resizable media as it showed it: $name", ({ html, drawn }) => {
    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const element = document.createElement('div')
    element.innerHTML = openConverted(result.state).getHTML()
    const media = [...element.querySelectorAll('img, video')].map((shown) => ({
      tag: shown.localName,
      align: shown.getAttribute('data-align'),
      float: shown.getAttribute('data-float'),
      width: shown.getAttribute('width'),
      height: shown.getAttribute('height'),
    }))
    expect([media, result.dropped]).toEqual([[drawn], []])
  })

  it.each([
    { name: 'an image marked a video', html: `<p><img src="${SRC}" media-type="video"></p>` },
    {
      name: 'a video marked an image',
      html: '<video src="/v.mp4" controls media-type="img"></video>',
    },
    {
      name: 'an alignment under both names',
      html: `<p><img src="${SRC}" media-type="img" dataalign="center" data-align="right"></p>`,
    },
    {
      name: 'an alignment the old editor never wrote',
      html: `<p><img src="${SRC}" media-type="img" dataalign="justify"></p>`,
    },
    {
      name: 'a float the old editor never wrote',
      html: `<p><img src="${SRC}" media-type="img" datafloat="center"></p>`,
    },
  ])('refuses old resizable media the mapping leaves alone: $name', ({ html }) => {
    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it.each([
    {
      tag: 'img',
      src: SRC,
      html: `<p><img src="${SRC}" uploadid="upload-1" error="Failed to upload image"></p>`,
    },
    {
      tag: 'video',
      src: '/v.mp4',
      html: '<video src="/v.mp4" controls uploadid="upload-1" error="true"></video>',
    },
  ])('records the upload marks frappe-ui never read back from HTML on a $tag', ({ src, html }) => {
    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const element = document.createElement('div')
    element.innerHTML = openConverted(result.state).getHTML()
    const [shown] = element.querySelectorAll('img, video')
    expect([shown.getAttribute('src'), result.dropped]).toEqual([
      src,
      [
        { kind: 'noise', name: 'uploadid' },
        { kind: 'noise', name: 'error' },
      ],
    ])
  })

  it.each([
    {
      name: 'a third attribute beside them',
      html: `<p><img src="${SRC}" uploadid="upload-1" error="true" data-foo="1"></p>`,
    },
    { name: 'one on a span', html: '<p><span uploadid="upload-1">x</span></p>' },
  ])('still refuses beside the upload marks: $name', ({ html }) => {
    expect(convertLegacy({ content: null, html, collab: 0, ycomments: null }, MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })

  it('keeps an attachment saved in the HTML with its name', () => {
    const html = '<p><a data-attachment href="/f.pdf" data-file-name="r.pdf">r.pdf</a></p>'

    const result = convert({ content: null, html, collab: 0, ycomments: null })

    const attachment = { type: 'attachment', attrs: { src: '/f.pdf', fileName: 'r.pdf' } }
    expect(bodyOf(result.state)).toEqual(page(paragraph(attachment)))
  })

  it('refuses HTML holding a table of contents, which the editor has no node for', () => {
    const toc = '<div data-type="toc-node"><ol><li>Intro</li></ol></div>'
    const legacy = { content: null, html: `${toc}<h2>Intro</h2>`, collab: 0, ycomments: null }

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('keeps an HTML link, which gains a target and rel', () => {
    const result = convert({
      content: null,
      html: '<p><a href="/a">go</a></p>',
      collab: 0,
      ycomments: null,
    })

    const [{ content }] = bodyOf(result.state).content
    expect(content[0].marks[0].attrs.href).toBe('/a')
  })

  it('converts an old Yjs bold stored as true as the bold mark', () => {
    const result = convert(stored(legacyDoc(yMarked('hi', { bold: true }))))

    const [{ content }] = bodyOf(result.state).content
    expect([content, result.dropped]).toEqual([
      [{ type: 'text', text: 'hi', marks: [{ type: 'bold' }] }],
      [],
    ])
  })

  it('refuses an old Yjs highlight stored as true', () => {
    const legacy = stored(legacyDoc(yMarked('hi', { namedHighlight: true })))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })

  it('keeps a Yjs link, which gains the link mark defaults', () => {
    const result = convert(stored(legacyDoc(yMarked('go', { link: { href: '/a' } }))))

    const [{ content }] = bodyOf(result.state).content
    expect(content[0].marks[0].attrs.href).toBe('/a')
  })

  it("keeps the target and rel Drive's links held, from HTML and from Yjs", () => {
    const drive = { target: '_blank', rel: 'noopener noreferrer nofollow' }
    const html = '<p><a href="/a" target="_blank" rel="noopener noreferrer nofollow">go</a></p>'
    const yjs = stored(legacyDoc(yMarked('go', { link: { href: '/a', ...drive, class: null } })))

    const results = [{ content: null, html, collab: 0, ycomments: null }, yjs].map(convert)

    for (const { state, dropped } of results) {
      const [{ content }] = bodyOf(state).content
      expect([content[0].marks[0].attrs, dropped]).toEqual([
        expect.objectContaining({ href: '/a', ...drive }),
        [],
      ])
    }
  })

  it('keeps a table whose cell holds its widths and a span at its default', () => {
    const cell = yElement('tableCell', yParagraph('x'))
    cell.setAttribute('colwidth', [100] as never)
    cell.setAttribute('colspan', 1 as never)
    const doc = legacyDoc(yElement('table', yElement('tableRow', cell)))

    const result = convert(stored(doc))

    const [table] = bodyOf(result.state).content
    expect(table.content[0].content[0].attrs).toMatchObject({ colwidth: [100], colspan: 1 })
  })

  it('refuses when converting the old media moves where an image points', () => {
    vi.mocked(convertOldMedia).mockImplementationOnce((body) => {
      const image = new XmlElement('image')
      image.setAttribute('src', '/files/other.png')
      body.delete(0, 1)
      body.insert(0, [yElement('paragraph', image)])
    })
    const legacy = stored(legacyDoc(oldMedia({ src: SRC, 'media-type': 'img' })))

    expect(convertLegacy(legacy, MAX_STATE)).toEqual({ kind: 'failed', reason: 'check' })
  })
})
