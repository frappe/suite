import { REMOTE } from '@suite/collab-client'
import { expect } from 'vitest'
import * as yjs from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { findRemovals, type Removal } from '@/apps/writer/collab/removals'
import {
  deliver,
  inside,
  sendRow,
  stored,
  syncAll,
  type Tab,
} from '@/apps/writer/collab/test-support'
import type { CollabRoom } from '@/platform/collab'

const QQ_OFFSET = 2

export function paragraph(...content: object[]) {
  return { type: 'paragraph', content }
}

export function text(value: string) {
  return { type: 'text', text: value }
}

export const threeParagraphs = stored(
  paragraph(text('abc')),
  paragraph(text('defgh')),
  paragraph(text('xyz')),
)

export function makeHeading(tab: Tab, word: string) {
  tab.editor.chain().setTextSelection(inside(tab, word)).setNode('heading', { level: 2 }).run()
}

export function typeAt(tab: Tab, word: string, offset: number, content: string | object) {
  tab.editor
    .chain()
    .setTextSelection(inside(tab, word, offset))
    .insertContent(content)
    .run()
}

export function typeQQ(tab: Tab, word: string) {
  tab.editor
    .chain()
    .setTextSelection(inside(tab, word, QQ_OFFSET))
    .insertContent('QQ')
    .run()
}

export function allReported(tabs: Tab[]) {
  return tabs.flatMap((tab) => tab.reported)
}

export async function sendInOrder(tabs: Tab[], senders: Tab[]) {
  await deliver(
    tabs,
    senders.map((sender) => [sender, sendRow(sender)]),
  )
  await syncAll(tabs)
}

export const lostQQ = {
  kind: 'text',
  seen: 'defgh',
  runs: [{ offset: 2, text: 'QQ', attrs: {} }],
  written: expect.anything(),
  pulled: expect.anything(),
  isUncertain: false,
}

// Text of mine yjs never kept, because it was written into a block already gone
export function neverKept(lost: string) {
  return {
    kind: 'text',
    seen: '',
    runs: [{ offset: 0, text: lost, attrs: {} }],
    written: expect.anything(),
    pulled: expect.anything(),
    isUncertain: false,
    key: expect.any(String),
  }
}

export function mention() {
  const element = new yjs.XmlElement('mention')
  element.setAttribute('id', 'someone')
  return element
}

export function docOf(update: Uint8Array) {
  const doc = new yjs.Doc()
  yjs.applyUpdate(doc, update)
  return doc
}

export function oldBlockText(doc: yjs.Doc) {
  const block = doc.getXmlFragment(BODY_FIELD).get(1) as yjs.XmlElement
  return block.get(0) as yjs.XmlText
}

export function removeOldBlock(doc: yjs.Doc) {
  const body = doc.getXmlFragment(BODY_FIELD)
  doc.transact(() => {
    body.delete(1, 1)
    body.insert(1, [new yjs.XmlElement('heading')])
  })
}

// Applies `updates` to `doc` as one pulled transaction and returns what it removed of `writer`'s
export function removalsOnApply(
  doc: yjs.Doc,
  updates: Uint8Array[],
  writer: yjs.Doc,
  origin = REMOTE,
) {
  const found: Removal[] = []
  doc.on('afterTransaction', (transaction: yjs.Transaction) => {
    found.push(...findRemovals(transaction, updates, new Set([writer.clientID])))
  })
  doc.transact(() => yjs.applyUpdate(doc, yjs.mergeUpdates(updates)), origin)
  return found
}

// Turns the room's second block into a heading reading `words`, in one edit
export function makeRoomHeading(room: CollabRoom, words: string) {
  const body = room.doc.getXmlFragment(BODY_FIELD)
  const heading = new yjs.XmlElement('heading')
  heading.setAttribute('level', '2')
  heading.insert(0, [new yjs.XmlText(words)])
  room.doc.transact(() => {
    body.delete(1, 1)
    body.insert(1, [heading])
  })
}

export function roomText(room: CollabRoom, index: number) {
  const block = room.doc.getXmlFragment(BODY_FIELD).get(index) as yjs.XmlElement
  return block.get(0) as yjs.XmlText
}

export function roomBlocks(room: CollabRoom) {
  const body = room.doc.getXmlFragment(BODY_FIELD).toArray() as yjs.XmlElement[]
  return body.map((block) => {
    const words = block.get(0).toString()
    return `${block.nodeName} ${words}`
  })
}
