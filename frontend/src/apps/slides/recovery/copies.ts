import * as Y from 'yjs'

import { api, client } from '@/api'
import { slidesAdapter } from '@/apps/slides/collab/adapter'
import { readSlides } from '@/apps/slides/collab/deck'
import {
  discardRecovery,
  readRecovery,
  recoveryFile,
  recoveryNodes,
  saveThroughBrowser,
} from '@/apps/slides/surface/recovery'
import { deleteDraft, settleDrafts } from '@/apps/slides/utils/drafts'
import { openSignedInDeviceStore, type RecoveryRecord } from '@/platform/collab'
import { getCookieSessionUser } from '@/platform/session'

/**
 * Slides' recovery copies on this device, of every kind it keeps: an old draft
 * from before every presentation edited in its live room (Q16), what the live
 * room kept when it couldn't send it, and the copies the editor kept in this
 * page's storage. A copy is never sent on its own and stays until the person
 * discards it.
 */
export interface RecoveryCopy {
  key: string
  // Null when the person can't open the presentation now
  node: string | null
  title: string
  savedAt: Date
  slides: unknown[]
  // The copy's size in bytes, as its JSON
  size: number
}

interface OldDraft {
  id: string
  content: unknown[]
  updatedAt: number
}

type RecoveryName = { presentation: string; node: string; title: string }

const DRAFT_PREFIX = 'draft:'
const STORE_PREFIX = 'store:'
const PAGE_PREFIX = 'page:'

// A browser without IndexedDB keeps none
function oldDrafts(id?: string): Promise<OldDraft[]> {
  return settleDrafts(getCookieSessionUser(), id).catch(() => [])
}

/** The old draft of one presentation, once its clean draft is gone; null when none is dirty. */
export async function oldDraftCopy(presentation: string, node: string, title: string) {
  const [draft] = await oldDrafts(presentation)
  if (!draft) {
    return null
  }

  return draftCopy(draft, { presentation, node, title })
}

function draftCopy(draft: OldDraft, name?: RecoveryName): RecoveryCopy {
  const slides = draft.content
  const fields = { node: name?.node ?? null, title: name?.title ?? '', slides }
  return {
    ...fields,
    key: `${DRAFT_PREFIX}${draft.id}`,
    savedAt: new Date(draft.updatedAt),
    size: sizeOf(slides),
  }
}

async function storeRecords() {
  const store = await openSignedInDeviceStore(slidesAdapter.app)
  return (await store?.allRecovery().catch(() => [])) ?? []
}

// A record that can't be read stays on the device, so the others still list
function storeCopy(record: RecoveryRecord): RecoveryCopy[] {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, record.state ?? Y.mergeUpdates(record.entries.map((entry) => entry.bytes)))
  } catch {
    return []
  }

  const slides = readSlides(doc)
  const fields = { node: record.doc, title: record.title ?? '', slides }
  return [
    {
      ...fields,
      key: `${STORE_PREFIX}${record.id}`,
      savedAt: new Date(record.created),
      size: sizeOf(slides),
    },
  ]
}

function pageCopies(names: Map<string, RecoveryName>): RecoveryCopy[] {
  return recoveryNodes().flatMap((node) =>
    readRecovery(node).map((copy) => ({
      key: `${PAGE_PREFIX}${node}:${copy.savedAt}`,
      node: names.get(node)?.node ?? null,
      title: names.get(node)?.title ?? '',
      savedAt: new Date(copy.savedAt),
      slides: copy.slides,
      size: sizeOf(copy.slides),
    })),
  )
}

// The most names the server reads at once
const NAMES_LIMIT = 200

// Names for the copies that carry no title, in reads of at most NAMES_LIMIT; a read that
// fails names none of its own. A presentation the person can't read answers none
async function recoveryNames(presentations: string[], nodes: string[]) {
  const reads = [
    ...batches(presentations).map((batch) => ({ presentations: batch, nodes: [] })),
    ...batches(nodes).map((batch) => ({ presentations: [], nodes: batch })),
  ]
  const names = await Promise.all(
    reads.map((read) => client.query(api.slides.recovery.names, read).catch(() => [])),
  )
  return names.flat()
}

function batches(names: string[]) {
  return Array.from({ length: Math.ceil(names.length / NAMES_LIMIT) }, (_, index) =>
    names.slice(index * NAMES_LIMIT, (index + 1) * NAMES_LIMIT),
  )
}

/** This device's copies, newest first. */
export async function listCopies(): Promise<RecoveryCopy[]> {
  const [drafts, records] = await Promise.all([oldDrafts(), storeRecords()])
  const nodes = recoveryNodes()
  const names = await recoveryNames(
    drafts.map((draft) => draft.id),
    nodes,
  )
  const byPresentation = new Map(names.map((name) => [name.presentation, name]))
  const byNode = new Map(names.map((name) => [name.node, name]))
  const copies = [
    ...drafts.map((draft) => draftCopy(draft, byPresentation.get(draft.id))),
    ...records.flatMap(storeCopy),
    ...pageCopies(byNode),
  ]
  return copies.sort((first, second) => second.savedAt.getTime() - first.savedAt.getTime())
}

/** Each copy's presentation, read with no server call: a draft names its presentation, the rest their node. */
export async function copyEntries() {
  const [drafts, records] = await Promise.all([oldDrafts(), storeRecords()])
  const pages = recoveryNodes().flatMap((node) => readRecovery(node).map(() => node))
  return [...drafts.map((draft) => draft.id), ...records.map((record) => record.doc), ...pages].map(
    (document) => ({ document }),
  )
}

/** Discards the copy as it was shown; a newer draft another tab wrote since stays. */
export async function discardCopy(copy: Pick<RecoveryCopy, 'key' | 'savedAt'>) {
  if (copy.key.startsWith(DRAFT_PREFIX)) {
    const id = copy.key.slice(DRAFT_PREFIX.length)
    await deleteDraft(getCookieSessionUser(), id, copy.savedAt.getTime())
    return
  }

  if (copy.key.startsWith(STORE_PREFIX)) {
    const store = await openSignedInDeviceStore(slidesAdapter.app)
    await store?.discard(Number(copy.key.slice(STORE_PREFIX.length)))
    return
  }

  const [node, savedAt] = splitOnce(copy.key.slice(PAGE_PREFIX.length))
  discardRecovery(node, savedAt)
}

// A node id holds no colon, and a saved time does
function splitOnce(value: string): [string, string] {
  const at = value.indexOf(':')
  return [value.slice(0, at), value.slice(at + 1)]
}

/** Saves the copy through the browser as JSON. The copy stays on the device. */
export function downloadCopy(copy: RecoveryCopy) {
  const kept = { savedAt: copy.savedAt.toISOString(), slides: copy.slides }
  saveThroughBrowser(recoveryFile(kept, copy.title || 'Presentation'))
}

function sizeOf(slides: unknown[]) {
  return new TextEncoder().encode(JSON.stringify(slides)).byteLength
}

const SAVED_AT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function savedAtLabel(copy: Pick<RecoveryCopy, 'savedAt'>) {
  return SAVED_AT.format(copy.savedAt)
}
