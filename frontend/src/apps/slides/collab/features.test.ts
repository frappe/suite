import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getSchema } from '@tiptap/core'
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { addBox, addSlide, BOX_KEYS, boxText, ROOT, SLIDE_KEYS } from './deck'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

// The bytes are compared whole, so every id they hold must come out the same each run
vi.mock('@/platform/random-id', () => {
  let made = 0

  return {
    randomId: () => {
      made += 1

      return `id${made}`
    },
  }
})

interface Features {
  schema: number
  features: Record<string, number>
  nodes: string[]
  marks: string[]
}

// The server refuses a row naming anything this file does not declare at or below the row's schema
const FEATURES_PATH = resolve(__dirname, '../../../../../suite/slides/content/schema.json')
const declared = JSON.parse(readFileSync(FEATURES_PATH, 'utf8')) as Features
// Python reads these bytes back and pushes them through the layer's own admission
const FIXTURE_PATH = resolve(__dirname, '../../../../../suite/slides/content/tests/deck_state.b64')

const FRAME = { left: 10, top: 10, width: 100, height: 50 }
const TEXT_STYLE = {
  fontSize: '20px',
  textTransform: 'uppercase',
  fontFamily: 'Inter',
  letterSpacing: '1px',
  opacity: 50,
  fontWeight: '600',
  color: '#112233',
}
const LINK = {
  href: 'https://example.com',
  target: '_blank',
  rel: 'noopener',
  class: 'plain',
  title: 'Example',
}

function words(text: string, ...marks: Record<string, unknown>[]) {
  return { type: 'text', text, marks }
}

function paragraph(...content: Record<string, unknown>[]) {
  return { type: 'paragraph', attrs: { textAlign: 'center', lineHeight: '1.2' }, content }
}

function cell(type: string) {
  const attrs = {
    colspan: 1,
    rowspan: 1,
    colwidth: [120],
    align: 'center',
    backgroundColor: '#ffeeaa',
  }

  return { type, attrs, content: [paragraph(words(type))] }
}

const TEXT_BODY = {
  type: 'doc',
  content: [
    paragraph(
      words(
        'every mark',
        { type: 'bold' },
        { type: 'italic' },
        { type: 'strike' },
        { type: 'underline' },
      ),
      words('styled', { type: 'textStyle', attrs: TEXT_STYLE }),
      words('linked', { type: 'link', attrs: LINK }),
      { type: 'hardBreak' },
      words('code', { type: 'code' }),
    ),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', attrs: { lineHeight: '2' }, content: [paragraph(words('bullet'))] },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 3, type: 'a' },
      content: [
        { type: 'listItem', attrs: { lineHeight: '2' }, content: [paragraph(words('numbered'))] },
      ],
    },
  ],
}

const TABLE_BODY = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader')] },
        { type: 'tableRow', content: [cell('tableCell')] },
      ],
    },
  ],
}

function writeBody(doc: Y.Doc, boxId: string, body: Record<string, unknown>) {
  const node = getSchema(extensions).nodeFromJSON(body)
  prosemirrorToYXmlFragment(node, boxText(doc, boxId)!)
}

// One of every box type, holding every field the deck keeps and every name the editor can write
function fullDeck() {
  const doc = new Y.Doc()
  doc.clientID = 7
  const slide = addSlide(doc, {
    background: 'https://example.com/background.png',
    transition: 'fade',
    transitionDuration: 0.5,
    fadeUnmatchedElements: true,
    advanceAfter: 5,
  })
  const shared = { frame: FRAME, rotation: 15, opacity: 90, locked: false, refId: 'ref1' }
  const border = { borderStyle: 'solid', borderWidth: 1, borderColor: '#000000', borderRadius: 4 }
  const shadow = {
    shadowColor: '#000000',
    shadowOpacity: 40,
    shadowBlur: 3,
    shadowOffset: 2,
    shadowAngle: 90,
  }
  const textBox = addBox(doc, slide, {
    ...shared,
    ...shadow,
    type: 'text',
    lineHeight: 1.5,
    color: '#111111',
  })
  const shape = addBox(doc, slide, {
    ...shared,
    ...border,
    type: 'shape',
    shapeType: 'oval',
    fillColor: '#222222',
    strokeColor: '#333333',
    strokeWidth: 2,
    strokeStyle: 'dashed',
  })
  const table = addBox(doc, slide, {
    ...shared,
    type: 'table',
    bandColor: '#444444',
    bandedRows: true,
    gridColor: '#555555',
    gridWidth: 1,
  })
  addBox(doc, slide, {
    ...shared,
    type: 'image',
    src: 'image-node',
    attachmentName: 'picture.png',
    useTemplateDimensions: false,
    crop: { left: 0, top: 0, width: 1, height: 1 },
    invertX: false,
    invertY: true,
  })
  addBox(doc, slide, {
    ...shared,
    type: 'video',
    src: 'video-node',
    poster: 'poster-node',
    autoplay: true,
    loop: false,
    playbackRate: 1,
  })
  addBox(doc, slide, {
    ...shared,
    type: 'line',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    markerStart: 'none',
    markerEnd: 'arrow',
    connectorStart: { elementId: textBox, anchor: 'right' },
    connectorEnd: { elementId: shape, anchor: 'left' },
    route: 'straight',
  })
  writeBody(doc, textBox, TEXT_BODY)
  writeBody(doc, shape, TEXT_BODY)
  writeBody(doc, table, TABLE_BODY)

  return doc
}

function editorNames() {
  const schema = getSchema(extensions)
  const names = new Set<string>()
  for (const type of [...Object.values(schema.nodes), ...Object.values(schema.marks)]) {
    if (type.name !== 'doc' && type.name !== 'text') {
      names.add(type.name)
    }

    for (const attribute of Object.keys(type.spec.attrs ?? {})) {
      names.add(attribute)
    }
  }

  return names
}

describe('slides collab features', () => {
  it('declares exactly the deck keys and the names the editor can write', () => {
    const expected = new Set([...Object.values(ROOT), ...SLIDE_KEYS, ...BOX_KEYS, ...editorNames()])
    expect(Object.keys(declared.features).sort()).toEqual([...expected].sort())
  })

  it('lists the names the server takes as elements and as marks', () => {
    const schema = getSchema(extensions)
    // The binding makes no element for the document or for text
    const nodes = Object.keys(schema.nodes).filter((name) => name !== 'doc' && name !== 'text')
    expect(declared.nodes).toEqual(nodes.sort())
    expect(declared.marks).toEqual(Object.keys(schema.marks).sort())
  })

  it('has no mark that overlaps itself, so every mark key is a plain mark name', () => {
    const marks = Object.values(getSchema(extensions).marks)
    const overlapping = marks.filter((mark) => !mark.excludes(mark)).map((mark) => mark.name)
    expect(overlapping).toEqual([])
  })

  it('introduces every name at a schema the server knows', () => {
    const versions = Object.values(declared.features)
    expect(versions.every((version) => Number.isInteger(version) && version >= 1)).toBe(true)
    expect(Math.max(...versions)).toBeLessThanOrEqual(declared.schema)
  })

  // Run with -u to refresh the bytes, and test_registration.py then proves the server takes them
  it('carries the bytes the deck writes today to the server tests', async () => {
    const state = Y.encodeStateAsUpdate(fullDeck())
    await expect(Buffer.from(state).toString('base64')).toMatchFileSnapshot(FIXTURE_PATH)
  })
})
