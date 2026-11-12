import * as Y from 'yjs'

import { api, client } from '@/api'
import { slidesAdapter } from '@/apps/slides/collab/adapter'
import { drawnSlides } from '@/apps/slides/collab/drawnDeck'
import {
  discardRecovery,
  readRecovery,
  recoveryEntries,
  recoveryFile,
  recoveryNodes,
  saveThroughBrowser,
} from '@/apps/slides/surface/recovery'
import {
  deleteDraft,
  deleteUnownedDraft,
  settleDrafts,
  unownedDrafts,
} from '@/apps/slides/utils/drafts'
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

type RecoveryName = { presentation: string; node: string; title: string; can_edit: boolean }

const DRAFT_PREFIX = 'draft:'
const SHARED_PREFIX = 'shared:'
const STORE_PREFIX = 'store:'
const PAGE_PREFIX = 'page:'

// A browser without IndexedDB keeps none
function oldDrafts(id?: string): Promise<OldDraft[]> {
  return settleDrafts(getCookieSessionUser(), id).catch(() => [])
}

// A browser without IndexedDB keeps none
function sharedDrafts(id?: string): Promise<OldDraft[]> {
  return unownedDrafts(id).catch(() => [])
}

/**
 * The old drafts of one presentation, newest first, once its clean draft is gone. An editor
 * is also shown a draft the shared store kept for no one, where it is, as its own copy.
 */
export async function oldDraftCopies(
  presentation: string,
  node: string,
  title: string,
  { isEditor }: { isEditor: boolean },
) {
  const name = { presentation, node, title, can_edit: isEditor }
  const [drafts, shared] = await Promise.all([
    oldDrafts(presentation),
    isEditor ? sharedDrafts(presentation) : [],
  ])
  return newestFirst([
    ...drafts.map((draft) => draftCopy(draft, name)),
    ...shared.map((draft) => draftCopy(draft, name, SHARED_PREFIX)),
  ])
}

function draftCopy(draft: OldDraft, name?: RecoveryName, prefix = DRAFT_PREFIX): RecoveryCopy {
  const slides = draft.content
  const fields = { node: name?.node ?? null, title: name?.title ?? '', slides }
  return {
    ...fields,
    key: `${prefix}${draft.id}`,
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

  // the drawn form, as a page copy holds it, so each element keeps its words
  const slides = drawnSlides(doc)
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
    recoveryEntries(node).map(({ id, copy }) => ({
      key: `${PAGE_PREFIX}${node}:${id}`,
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

// Names for the copies that carry no title, in reads of at most NAMES_LIMIT names of either
// kind; a read that fails names none of its own. A presentation the person can't read answers none
async function recoveryNames(presentations: string[], nodes: string[]) {
  const total = presentations.length + nodes.length
  // Read `index` takes the names at [start, end) of the presentations followed by the nodes
  const reads = Array.from({ length: Math.ceil(total / NAMES_LIMIT) }, (_, index) => {
    const [start, end] = [index * NAMES_LIMIT, (index + 1) * NAMES_LIMIT]
    const [nodeStart, nodeEnd] = [start, end].map((at) => Math.max(0, at - presentations.length))
    return {
      presentations: presentations.slice(start, end),
      nodes: nodes.slice(nodeStart, nodeEnd),
    }
  })
  const names = await Promise.all(
    reads.map((read) => client.query(api.slides.recovery.names, read).catch(() => [])),
  )
  return names.flat()
}

/** This device's copies, newest first. */
export async function listCopies(): Promise<RecoveryCopy[]> {
  const [drafts, shared, records] = await Promise.all([oldDrafts(), sharedDrafts(), storeRecords()])
  const nodes = recoveryNodes()
  const presentations = new Set([...drafts, ...shared].map((draft) => draft.id))
  const names = await recoveryNames([...presentations], nodes)
  const byPresentation = new Map(names.map((name) => [name.presentation, name]))
  const byNode = new Map(names.map((name) => [name.node, name]))
  // A shared draft shows only to an editor of its presentation
  const editable = shared.filter((draft) => byPresentation.get(draft.id)?.can_edit)
  return newestFirst([
    ...drafts.map((draft) => draftCopy(draft, byPresentation.get(draft.id))),
    ...editable.map((draft) => draftCopy(draft, byPresentation.get(draft.id), SHARED_PREFIX)),
    ...records.flatMap(storeCopy),
    ...pageCopies(byNode),
  ])
}

function newestFirst(copies: RecoveryCopy[]) {
  return copies.sort((first, second) => second.savedAt.getTime() - first.savedAt.getTime())
}

/**
 * Each copy's presentation, read with no server call: a draft names its presentation, the rest
 * their node. A shared draft isn't counted, as only the server knows who may edit it.
 */
export async function copyEntries() {
  const [drafts, records] = await Promise.all([oldDrafts(), storeRecords()])
  const pages = recoveryNodes().flatMap((node) => readRecovery(node).map(() => node))
  return [...drafts.map((draft) => draft.id), ...records.map((record) => record.doc), ...pages].map(
    (document) => ({ document }),
  )
}

/** Discards the copy as it was shown; a newer draft another tab wrote since stays. */
export async function discardCopy(copy: Pick<RecoveryCopy, 'key' | 'savedAt' | 'slides'>) {
  const shown = { updatedAt: copy.savedAt.getTime(), content: JSON.stringify(copy.slides) }
  if (copy.key.startsWith(DRAFT_PREFIX)) {
    await deleteDraft(getCookieSessionUser(), { ...shown, id: copy.key.slice(DRAFT_PREFIX.length) })
    return
  }

  if (copy.key.startsWith(SHARED_PREFIX)) {
    await deleteUnownedDraft({ ...shown, id: copy.key.slice(SHARED_PREFIX.length) })
    return
  }

  if (copy.key.startsWith(STORE_PREFIX)) {
    const store = await openSignedInDeviceStore(slidesAdapter.app)
    await store?.discard(Number(copy.key.slice(STORE_PREFIX.length)))
    return
  }

  // a node id holds no colon
  const place = copy.key.slice(PAGE_PREFIX.length)
  const [node, id] = [place.slice(0, place.indexOf(':')), place.slice(place.indexOf(':') + 1)]
  discardRecovery(node, id, { slides: copy.slides })
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
