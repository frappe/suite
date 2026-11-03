import { watch } from 'vue'

import type { MediaHandle } from '@/apps/drive'

/** Opens the Drive media handle for one of the deck's media node ids. */
export type DocumentMedia = (id: string) => MediaHandle

// A stored media reference is one whole node id (spec §14.7), the shape
// `suite/slides/drive.py` reads. Node ids are opaque hashes, so a `/files/`
// path, a `/private/files/` url and a `data:` url all fail this.
const MEDIA_NODE_ID = /^[A-Za-z0-9_-]{1,140}$/

export const isMediaNodeId = (value: unknown): value is string =>
  typeof value === 'string' && MEDIA_NODE_ID.test(value)

// The `/d/` surface hands the store its Drive session's media handles, the way
// `setDocumentFetch` hands it the session's fetch. Old pages set none.
let documentMedia: DocumentMedia | null = null

export const setDocumentMedia = (media: DocumentMedia) => {
  documentMedia = media
  return () => {
    if (documentMedia === media) documentMedia = null
  }
}

/**
 * The signed url Drive holds for one media node (spec §6.8), or '' while it is
 * still loading, once Drive refused it, or when no deck session is open. Read
 * from a template or a computed, it follows the handle as Drive re-signs the url.
 */
export const mediaNodeUrl = (id: string): string => {
  const handle = documentMedia?.(id)
  if (!handle || handle.status.value === 'refused') return ''
  return handle.src.value ?? ''
}

export function isMediaRefused(id: string) {
  return documentMedia?.(id).status.value === 'refused'
}

/** Calls back when Drive's answer for any of these nodes changes; returns the stop. */
export function onMediaStatusChange(ids: string[], changed: () => void) {
  const handles = ids.flatMap((id) => documentMedia?.(id) ?? [])
  return watch(() => handles.map((handle) => handle.status.value).join(), changed)
}

const SETTLE_TIMEOUT = 30_000

function loadingIds(handles: MediaHandle[]) {
  return handles.filter((handle) => handle.status.value === 'loading').map((handle) => handle.id)
}

/** Resolves with the media nodes still loading once Drive has answered for every one, on abort, or after 30s. */
export async function mediaSettled(ids: string[], signal?: AbortSignal): Promise<string[]> {
  const handles = ids.flatMap((id) => documentMedia?.(id) ?? [])
  function isSettled() {
    return handles.every((handle) => handle.status.value !== 'loading')
  }

  if (signal?.aborted || isSettled()) {
    return loadingIds(handles)
  }

  await new Promise<void>((resolve) => {
    const stop = watch(isSettled, (isNowSettled) => {
      if (isNowSettled) {
        finish()
      }
    })
    const timer = setTimeout(finish, SETTLE_TIMEOUT)
    function finish() {
      stop()
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }

    signal?.addEventListener('abort', finish, { once: true })
    // the session reads its media together, so one handle asks for them all
    void handles.find((handle) => handle.status.value === 'loading')?.refresh()
  })

  return loadingIds(handles)
}
