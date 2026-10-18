import type { DeviceStore, RecoveryRecord } from '@suite/collab-client'
import * as yjs from 'yjs'

import { writerDeviceStore } from '@/apps/writer/collab'
import { writerRender } from '@/apps/writer/collab/render'

/**
 * Writer's recovery copies: work kept on this device because it could not
 * reach the server. The live editor keeps them in its device store; the old
 * editor, and a browser without that store, in this page's storage. A copy is
 * never sent on its own and stays until the person discards it.
 */
export interface RecoveryCopy {
  key: string
  node: string
  title: string
  savedAt: Date
  html: string
  text: string
  // The copy's size in bytes, as its HTML
  size: number
}

interface PageCopy {
  node?: string
  title?: string
  savedAt: string
  html: string
}

const PAGE_PREFIX = 'suite:writer-recovery:'
const STORE_PREFIX = 'store:'
// One page copy per tab load, so a later tab never writes over an earlier tab's copy
const PAGE_LOAD = String(Date.now() + Math.random())

export function keepPageCopy(node: string, title: string, html: string, now = new Date()) {
  const copy: PageCopy = { node, title, savedAt: now.toISOString(), html }
  localStorage.setItem(`${PAGE_PREFIX}${node}:${PAGE_LOAD}`, JSON.stringify(copy))
}

/** This device's copies, newest first; of one document when `node` is given. */
export async function listCopies(node?: string): Promise<RecoveryCopy[]> {
  const copies = [...(await storeCopies(node)), ...pageCopies(node)]
  return copies.sort((first, second) => second.savedAt.getTime() - first.savedAt.getTime())
}

/** Each copy's document, without rendering the copies; a page copy that can't be read counts as none. */
export async function copyEntries() {
  const store = await writerDeviceStore()
  const records = (await store?.allRecovery().catch(() => [])) ?? []
  const stored = records.map((record) => ({ document: record.doc }))
  return [...stored, ...pageKeys().flatMap(pageEntry)]
}

function pageEntry(key: string) {
  const stored = storedPageCopy(key)
  if (!stored) {
    return []
  }

  return [{ document: stored.node }]
}

export async function discardCopy(copy: RecoveryCopy) {
  if (!copy.key.startsWith(STORE_PREFIX)) {
    localStorage.removeItem(copy.key)
    return
  }

  const store = await writerDeviceStore()
  await store?.discard(Number(copy.key.slice(STORE_PREFIX.length)))
}

async function storeCopies(node?: string) {
  const store = await writerDeviceStore()
  if (!store) {
    return []
  }

  const records = await recordsOf(store, node).catch(() => [])
  return records.flatMap(readableCopy)
}

// A record that can't be read stays on the device, so the others still list
function readableCopy(record: RecoveryRecord): RecoveryCopy[] {
  try {
    return [fromRecord(record)]
  } catch {
    return []
  }
}

function recordsOf(store: DeviceStore, node?: string) {
  if (node) {
    return store.recovery(node)
  }

  return store.allRecovery()
}

function fromRecord(record: RecoveryRecord): RecoveryCopy {
  // A copy without a snapshot shows what of its changes reads on its own
  const updates = record.entries.map((entry) => entry.bytes)
  const doc = new yjs.Doc()
  yjs.applyUpdate(doc, record.state ?? yjs.mergeUpdates(updates))
  const { html, text } = writerRender(doc)
  const fields = { node: record.doc, title: record.title ?? '', html, text }
  const key = `${STORE_PREFIX}${record.id}`
  return { ...fields, key, savedAt: new Date(record.created), size: sizeOf(html) }
}

function pageCopies(node?: string) {
  const keys = pageKeys().filter((key) => isPageCopyOf(key, node))
  return keys.map(readPageCopy).filter((copy): copy is RecoveryCopy => copy !== null)
}

// A browser that blocks site data throws on reading it, and keeps no page copies
function pageKeys() {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith(PAGE_PREFIX))
  } catch {
    return []
  }
}

// A copy from before page loads were told apart is keyed by its document alone
function isPageCopyOf(key: string, node?: string) {
  if (node === undefined) {
    return key.startsWith(PAGE_PREFIX)
  }

  const nodeKey = `${PAGE_PREFIX}${node}`
  return key === nodeKey || key.startsWith(`${nodeKey}:`)
}

function storedPageCopy(key: string): (PageCopy & { node: string }) | null {
  let stored: Partial<PageCopy> | null
  try {
    stored = JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }

  if (typeof stored?.html !== 'string' || typeof stored.savedAt !== 'string') {
    return null
  }

  // A copy from before page loads were told apart is keyed by its document alone
  const node = stored.node ?? key.slice(PAGE_PREFIX.length)
  return { node, title: stored.title, html: stored.html, savedAt: stored.savedAt }
}

function readPageCopy(key: string): RecoveryCopy | null {
  const stored = storedPageCopy(key)
  if (!stored) {
    return null
  }

  const html = stored.html
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
  const fields = { key, node: stored.node, title: stored.title ?? '', html, text }
  return { ...fields, savedAt: new Date(stored.savedAt), size: sizeOf(html) }
}

function sizeOf(html: string) {
  return new TextEncoder().encode(html).byteLength
}

/** The copy as a standalone HTML document, named after the document title. */
export function recoveryFile(copy: Pick<RecoveryCopy, 'title' | 'savedAt' | 'html'>): File {
  const title = copy.title || 'Document'
  const name = title.replace(/[<>:"/\\|?*]/g, '').trim() || 'Document'
  const escapedTitle = escapeText(title)
  const savedAt = copy.savedAt.toISOString()
  const page = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapedTitle}</title>`,
    `<meta name="recovered-at" content="${savedAt}">`,
    '</head><body>',
    copy.html,
    '</body></html>',
  ].join('\n')
  return new File([page], `${name} (recovered).html`, { type: 'text/html' })
}

/** Saves the copy through the browser. The copy stays on the device. */
export function downloadCopy(copy: Pick<RecoveryCopy, 'title' | 'savedAt' | 'html'>) {
  const file = recoveryFile(copy)
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Puts the copy on the clipboard, formatted where the browser allows. */
export async function copyToClipboard(copy: RecoveryCopy) {
  if (typeof ClipboardItem === 'undefined') {
    await navigator.clipboard.writeText(copy.text)
    return
  }

  const item = new ClipboardItem({
    'text/html': new Blob([copy.html], { type: 'text/html' }),
    'text/plain': new Blob([copy.text], { type: 'text/plain' }),
  })
  await navigator.clipboard.write([item])
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SAVED_AT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function savedAtLabel(copy: RecoveryCopy) {
  return SAVED_AT.format(copy.savedAt)
}
