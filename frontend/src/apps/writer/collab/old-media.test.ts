import { getSchema } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import { Doc, XmlElement, XmlText } from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { convertOldMedia } from '@/apps/writer/collab/old-media'
import { writerSchema } from '@/apps/writer/schema'

const schema = getSchema(writerSchema())

function oldMedia(attributes: Record<string, unknown>) {
  const node = new XmlElement('resizableMedia')
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value as string)
  }

  return node
}

function blockImage(attributes: Record<string, string>) {
  const node = new XmlElement('image')
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value)
  }

  return node
}

function yElement(name: string, ...children: XmlElement[]) {
  const node = new XmlElement(name)
  node.insert(0, children)
  return node
}

function yParagraph(text: string) {
  const node = new XmlElement('paragraph')
  node.insert(0, [new XmlText(text)])
  return node
}

function converted(...blocks: XmlElement[]) {
  const doc = new Doc()
  const body = doc.getXmlFragment(BODY_FIELD)
  body.insert(0, blocks)
  convertOldMedia(body)
  return schema.nodeFromJSON(yXmlFragmentToProsemirrorJSON(body)).toJSON()
}

function paragraph(...content: object[]) {
  return { type: 'paragraph', content }
}

function image(attrs: object) {
  return { type: 'image', attrs }
}

function page(...content: object[]) {
  return schema.nodeFromJSON({ type: 'doc', content }).toJSON()
}

const SRC = '/private/files/chart.png'

describe('convertOldMedia', () => {
  it('turns an old image into an image in its own paragraph, keeping its source, text and size', () => {
    const old = oldMedia({
      src: SRC,
      'media-type': 'img',
      alt: 'Sales chart',
      title: 'Q3',
      width: 300,
      height: '200',
      dataAlign: 'right',
    })

    const body = converted(yParagraph('before'), old, yParagraph('after'))

    const kept = {
      src: SRC,
      alt: 'Sales chart',
      title: 'Q3',
      width: 300,
      height: 200,
      align: 'right',
    }
    expect(body).toEqual(
      page(
        paragraph({ type: 'text', text: 'before' }),
        paragraph(image(kept)),
        paragraph({ type: 'text', text: 'after' }),
      ),
    )
  })

  it.each([
    { name: 'no alignment', stored: {}, shown: { align: 'left' } },
    {
      name: 'a float only',
      stored: { dataFloat: 'right' },
      shown: { align: 'left', float: 'right' },
    },
    {
      name: 'alignment and float',
      stored: { dataAlign: 'center', dataFloat: 'left' },
      shown: { align: 'center' },
    },
    {
      name: 'a percent width',
      stored: { width: '100%', height: 'auto' },
      shown: { align: 'left' },
    },
    {
      name: 'a resized width and a height of NaN',
      stored: { width: 420, height: Number.NaN },
      shown: { align: 'left', width: 420 },
    },
    {
      name: 'a percent width and a pixel height',
      stored: { width: '100%', height: 200 },
      shown: { align: 'left' },
    },
  ])('lays out an old image with $name as the old editor showed it', ({ stored, shown }) => {
    const body = converted(oldMedia({ src: SRC, 'media-type': 'img', ...stored }))

    expect(body).toEqual(page(paragraph(image({ src: SRC, ...shown }))))
  })

  it('turns an old video into a video, after an empty paragraph where it would open a list item', () => {
    const video = { src: '/files/demo.mp4', 'media-type': 'video', dataAlign: 'center' }
    const item = yElement('listItem', oldMedia(video))

    const body = converted(oldMedia(video), yElement('bulletList', item))

    const shown = { type: 'video', attrs: { src: '/files/demo.mp4', align: 'center' } }
    const list = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(), shown] }],
    }
    expect(body).toEqual(page(shown, list))
  })

  it('keeps an old image in a list item or a table cell, in a paragraph there', () => {
    const media = { src: SRC, 'media-type': 'img' }
    const item = yElement('listItem', yParagraph('item'), oldMedia(media))
    const row = yElement('tableRow', yElement('tableCell', oldMedia(media)))

    const body = converted(yElement('bulletList', item), yElement('table', row))

    const shown = paragraph(image({ src: SRC, align: 'left' }))
    const listItem = {
      type: 'listItem',
      content: [paragraph({ type: 'text', text: 'item' }), shown],
    }
    const table = {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [shown] }] }],
    }
    expect(body).toEqual(page({ type: 'bulletList', content: [listItem] }, table))
  })

  it("turns Drive's block image into an image in its own paragraph, keeping all it stored", () => {
    const stored = { src: SRC, uploadId: 'u1', alt: 'Sales chart', title: 'Q3' }
    const quote = yElement('blockquote', blockImage({ ...stored, align: 'right' }))
    const row = yElement('tableRow', yElement('tableCell', blockImage(stored)))

    const body = converted(blockImage(stored), quote, yElement('table', row))

    const shown = paragraph(image({ ...stored, align: 'left' }))
    const right = paragraph(image({ ...stored, align: 'right' }))
    const quoted = { type: 'blockquote', content: [right] }
    const table = {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [shown] }] }],
    }
    expect(body).toEqual(page(shown, quoted, table))
  })

  it('leaves an image in a paragraph or an image group as it is', () => {
    const inParagraph = yElement('paragraph', blockImage({ src: SRC }))
    const group = yElement('imageGroup', blockImage({ src: SRC }), blockImage({ src: SRC }))

    const body = converted(inParagraph, group)

    const kept = image({ src: SRC })
    expect(body).toEqual(page(paragraph(kept), { type: 'imageGroup', content: [kept, kept] }))
  })
})
