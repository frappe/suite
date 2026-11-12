/**
 * The Versions panel's work beyond Drive's list: reading a stored version,
 * the cells it holds differently from the sheet as it is now, and a new
 * spreadsheet made from it.
 */

import { ref } from 'vue'
import * as Y from 'yjs'

import { api, client } from '@/api'
import type { DocumentSession } from '@/apps/drive'
import { translate as __ } from '@/platform/translation'

import { changedCells, type ChangedCell } from '../collab/changes'
import { readStoredVersion, writeVersionToCopy } from '../collab/restore'
import { readVersions, stampLabel, type SheetVersion } from './records'

/** One version shown read-only in the editor. */
export interface VersionPreview {
  version: SheetVersion
  bytes: Uint8Array<ArrayBuffer>
  /** Cells that differ from the sheet as it was when the preview opened; null when they can't be listed. */
  changes: ChangedCell[] | null
}

/** The sheet's versions, page by page, newest first. */
export function useVersionList(session: DocumentSession) {
  const versions = ref<SheetVersion[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(true)
  const loadingMore = ref(false)
  const loadError = ref('')
  // Where the panel was scrolled to, so a remounted panel comes back there.
  const scrollTop = ref(0)

  async function load(cursor?: string) {
    try {
      const page = readVersions(await session.versions.list(cursor))
      versions.value = cursor ? [...versions.value, ...page.rows] : page.rows
      nextCursor.value = page.nextCursor
      if (!cursor) loadError.value = ''
    } catch (error) {
      // A failed next page keeps the rows already shown.
      if (!cursor) loadError.value = errorText(error, __('Check your connection, then try again.'))
      else throw error
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (!nextCursor.value) return
    loadingMore.value = true
    try {
      await load(nextCursor.value)
    } finally {
      loadingMore.value = false
    }
  }

  async function retry() {
    loading.value = true
    await load()
  }

  function rememberScroll(top: number) {
    scrollTop.value = top
  }

  /** Names a version; an empty name clears it. */
  async function rename(version: SheetVersion, label: string) {
    await session.versions.update(version.seq, { label })
    const named = { ...version, label: label || null }
    versions.value = versions.value.map((row) => (row.seq === version.seq ? named : row))
    return named
  }

  return {
    versions,
    nextCursor,
    loading,
    loadingMore,
    loadError,
    scrollTop,
    load,
    loadMore,
    retry,
    rememberScroll,
    rename,
  }
}

export type VersionList = ReturnType<typeof useVersionList>

/** The stored bytes of version `seq`. */
export async function fetchVersion(
  session: DocumentSession,
  seq: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await session.credentials.fetch(session.versions.contentUrl(seq))
  if (!response.ok) throw new Error(__('The version could not be read.'))
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Reads version `bytes` for the preview. `current` is the live room's doc as
 * one update; without it, or for a version from before editing together, the
 * changed cells can't be listed.
 */
export async function readPreview(
  version: SheetVersion,
  bytes: Uint8Array<ArrayBuffer>,
  current: Uint8Array | null,
): Promise<VersionPreview> {
  const stored = await readStoredVersion(bytes)
  if (!stored) throw new Error(__("This version can't be shown."))
  const changes = current && 'state' in stored ? listChanges(stored.state, current) : null
  return { version, bytes, changes }
}

function listChanges(versionState: Uint8Array, currentState: Uint8Array): ChangedCell[] {
  const version = new Y.Doc()
  const current = new Y.Doc()
  try {
    Y.applyUpdate(version, versionState)
    Y.applyUpdate(current, currentState)
    return changedCells(version, current)
  } finally {
    version.destroy()
    current.destroy()
  }
}

/** The step after `step` through `count` changes, `delta` forwards or back, wrapping at either end. */
export function nextStep(step: number | null, delta: 1 | -1, count: number): number | null {
  if (!count) return null
  if (step === null) return delta > 0 ? 0 : count - 1
  return (step + delta + count) % count
}

/**
 * Makes a new spreadsheet in `folder` that holds version `bytes`: Drive copies
 * the sheet, then the copy's room takes the version as one edit. A copy that
 * could not take it is put in the trash, so no copy is left that only looks
 * like the version. Answers the copy's node.
 */
export async function copyFromVersion(
  session: DocumentSession,
  folder: string,
  bytes: Uint8Array,
  title: string,
  write: typeof writeVersionToCopy = writeVersionToCopy,
): Promise<{ name: string; title: string }> {
  const stored = await readStoredVersion(bytes)
  if (!stored || !('state' in stored)) {
    throw new Error(
      __("This version is from before editing together, so a copy can't be made from it."),
    )
  }
  const copy = await session.copy(folder, title)
  // The copy belongs to the signed-in person; the sheet's link code it carries goes unused.
  const target = {
    nodeId: copy.name,
    credentials: session.credentials,
    title: { value: copy.title },
  }
  const isWritten = await write(target, stored.state).catch(() => false)
  if (!isWritten) {
    await client
      .mutation(api.drive.nodes.trash, { node: copy.name, state: 'Trashed' }, { silent: true })
      .catch(() => {})
    throw new Error(__('The copy could not be made. Try again in a moment.'))
  }
  return { name: copy.name, title: copy.title }
}

// Literal __() calls, so the extractor finds them; called when shown.
const KIND_LABELS = new Map<string, () => string>(
  Object.entries({
    auto: () => __('Automatic version'),
    named: () => __('Named version'),
    milestone: () => __('Milestone'),
  }),
)

/** A version's name, or what kind of version it is. */
export function versionTitle(version: SheetVersion): string {
  return version.label || KIND_LABELS.get(version.kind)?.() || __('Version')
}

/** When a version was taken, and by whom. */
export function versionByline(version: SheetVersion): string {
  const who = version.person?.full_name ?? version.actor
  return [stampLabel(version.creation), who].filter(Boolean).join(' · ')
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
