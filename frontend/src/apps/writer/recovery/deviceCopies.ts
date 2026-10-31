import { createDocument, getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import * as yjs from 'yjs'

import { api, client } from '@/api'
import type { DocumentSession } from '@/apps/drive'
import { BODY_FIELD } from '@/apps/writer/collab'
import { writerAdapter } from '@/apps/writer/collab/adapter'
import { writerRender } from '@/apps/writer/collab/render'
import { writerSchema } from '@/apps/writer/schema'
import type { WriterDocumentRow } from '@/apps/writer/surface/writerDocument'
import { openSignedInDeviceStore } from '@/platform/collab'
import { randomId } from '@/platform/random-id'

import { keepPageCopy } from './copies'

/**
 * The old editor's work on this device, keyed by Drive node: its Yjs store
 * `fdoc-<node>` and its draft in the `Writer` database. Each open keeps what the row lacks as a
 * recovery copy, once, and never deletes the old stores, which a stale tab may
 * still write to.
 */
type OldRow = Pick<WriterDocumentRow, 'content' | 'html' | 'content_modified' | 'conversion'>

interface OldDraft {
  val?: unknown
  saved?: unknown
}

const KEPT_PREFIX = 'suite:writer-device-copied:'
const schema = getSchema(writerSchema())

/** Keeps the old editor's unsaved work on this device as recovery copies of the document. */
export async function keepDeviceCopies(session: DocumentSession, row: OldRow) {
  // Each store is kept on its own, so one that fails leaves the other's work kept
  try {
    await keepYjsCopy(session, row)
  } catch {
    // Tried again on the next open
  }

  try {
    await keepDraftCopy(session.nodeId, session.title.value, row)
  } catch {
    // Tried again on the next open
  }
}

async function keepYjsCopy(session: DocumentSession, row: OldRow) {
  const node = session.nodeId
  const updates = await readFrom<unknown[]>(`fdoc-${node}`, 'updates', (store) => store.getAll())
  if (!updates?.length) {
    return
  }

  // Keyed by the device's own updates, so work already kept costs no fetch of the old body
  const key = `yjs:${await digest(yjs.encodeStateVector(mergedDoc(new yjs.Doc(), updates)))}`
  if (isKept(node, key)) {
    return
  }

  const base = rowDoc(await oldContent(session, row))
  const merged = mergedDoc(base, updates)
  // Holds the base, so it differs only by what the device added or deleted
  if (yjs.equalSnapshots(yjs.snapshot(merged), yjs.snapshot(base))) {
    return
  }

  const state = yjs.encodeStateAsUpdate(merged)
  await keepOnce(node, key, () => keepState(node, session.title.value, state))
}

async function oldContent(session: DocumentSession, row: OldRow) {
  if (row.conversion) {
    return row.content
  }

  // A converted row's `content` is the new lineage, so the base is the old body conversion kept
  const context = session.credentials.context
  const old = await client.query(
    api.writer.documents.oldBody,
    { node: session.nodeId },
    { context },
  )
  return old.content
}

function mergedDoc(base: yjs.Doc, updates: unknown[]) {
  const merged = new yjs.Doc()
  yjs.applyUpdate(merged, yjs.encodeStateAsUpdate(base))
  for (const update of updates) {
    // An update Yjs can't read is skipped, not copied
    try {
      yjs.applyUpdate(merged, update as Uint8Array)
    } catch {
      continue
    }
  }

  return merged
}

async function keepDraftCopy(node: string, title: string, row: OldRow) {
  const draft = await readFrom<OldDraft>('Writer', 'content', (store) => store.get(node))
  const html = draft?.val
  const saved = draft?.saved
  if (typeof html !== 'string' || !(saved instanceof Date) || html === (row.html ?? '')) {
    return
  }

  // A save after the draft holds what the person meant to keep
  if (row.content_modified && saved <= new Date(row.content_modified)) {
    return
  }

  const doc = prosemirrorJSONToYDoc(schema, createDocument(html, schema).toJSON(), BODY_FIELD)
  const stamp = saved.toISOString()
  await keepOnce(node, `draft:${stamp}`, () => keepState(node, title, yjs.encodeStateAsUpdate(doc)))
}

// The row's old body, or none when it can't be read
function rowDoc(content: string | null | undefined) {
  const doc = new yjs.Doc()
  if (!content) {
    return doc
  }

  try {
    yjs.applyUpdate(
      doc,
      Uint8Array.from(atob(content), (char) => char.charCodeAt(0)),
    )
  } catch {
    return new yjs.Doc()
  }

  return doc
}

async function digest(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
  return btoa(String.fromCharCode(...hash))
}

function keptKeys(node: string): string[] {
  return JSON.parse(localStorage.getItem(`${KEPT_PREFIX}${node}`) ?? '[]')
}

function isKept(node: string, key: string) {
  return keptKeys(node).includes(key)
}

// Each piece of old work is kept once, so a discarded copy doesn't come back
async function keepOnce(node: string, key: string, keep: () => Promise<boolean>) {
  // One tab at a time, so two tabs opening the document together keep the work once
  if (!navigator.locks) {
    await keepUnlessKept(node, key, keep)
    return
  }

  await navigator.locks.request(`${KEPT_PREFIX}${node}`, () => keepUnlessKept(node, key, keep))
}

async function keepUnlessKept(node: string, key: string, keep: () => Promise<boolean>) {
  if (isKept(node, key) || !(await keep())) {
    return
  }

  localStorage.setItem(`${KEPT_PREFIX}${node}`, JSON.stringify([...keptKeys(node), key]))
}

async function keepState(node: string, title: string, state: Uint8Array) {
  const store = await openSignedInDeviceStore(writerAdapter.app)
  // A page copy isn't counted as kept: a later one of this tab load writes over it
  if (!store) {
    const doc = new yjs.Doc()
    yjs.applyUpdate(doc, state)
    keepPageCopy(node, title, writerRender(doc).html)
    return false
  }

  const id = randomId()
  const sid = `old-editor-${id}`
  const entry = { doc: node, sid, seq: 0, bytes: state, sha: '', seenRev: 0 }
  try {
    await store.recover(node, [sid], 'old-editor', [entry], { state, title })
  } catch {
    return false
  }

  return true
}

// Reads one store of a database that already exists, never creating it
async function readFrom<T>(
  name: string,
  storeName: string,
  read: (store: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> {
  const db = await openExisting(name)
  if (!db) {
    return undefined
  }

  try {
    if (!db.objectStoreNames.contains(storeName)) {
      return undefined
    }

    return await new Promise<T | undefined>((resolve) => {
      const request = read(db.transaction(storeName).objectStore(storeName))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => resolve(undefined)
    })
  } finally {
    db.close()
  }
}

function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name)
    // A database that doesn't exist yet would be made here, so the open is undone
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}
