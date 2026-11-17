import { readonly, ref, type Ref } from 'vue'

import { api } from '@/api'
import type { ImperativeClient } from '@/platform/server-state/types'
import { isRefusal, type RequestContext } from '@/platform/transport'

// Signed media urls live 15 minutes; a read every 10 re-signs them in time.
export const MEDIA_REFRESH_MS = 10 * 60_000
const MEDIA_RETRY_MS = 2_000
const MEDIA_RETRY_GROWTH = 2
const MEDIA_RETRY_MAX_MS = 30_000

/** `unanswered`: a read for this picture failed in passing and none has answered for it yet. */
export type MediaStatus = 'loading' | 'unanswered' | 'ready' | 'refused'
export interface MediaHandle {
  readonly id: string
  readonly src: Readonly<Ref<string | null>>
  readonly cacheKey: Readonly<Ref<string>>
  readonly status: Readonly<Ref<MediaStatus>>
  refresh(): Promise<void>
}

/** The signed urls of one node's media, read from `nodes/<node>/media` and re-signed in time. */
export interface MediaReader {
  media(id: string): MediaHandle
  dispose(): void
}

export interface MediaReaderDependencies {
  client: ImperativeClient
  /** The link credentials to read with. Without it the client sends the node's own codes. */
  context?: RequestContext
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
}

interface InternalMediaHandle {
  id: string
  src: Ref<string | null>
  cacheKey: Ref<string>
  status: Ref<MediaStatus>
  public: MediaHandle
}

/**
 * Opens a reader for the media children of `nodeId`. A handle asks for its
 * picture on first use; one read answers every handle, and a picture the read
 * does not list is refused.
 */
export function openMediaReader(
  nodeId: string,
  dependencies: MediaReaderDependencies,
): MediaReader {
  const requester = dependencies.client
  const controller = new AbortController()
  const handles = new Map<string, InternalMediaHandle>()
  let disposed = false
  let mediaPromise: Promise<void> | null = null
  let failedReads = 0
  let mediaRetry: ReturnType<typeof setTimeout> | undefined

  const refreshMedia = async () => {
    if (disposed) return
    if (mediaPromise) return mediaPromise

    clearTimeout(mediaRetry)

    // a handle made after the read began may name a picture newer than its answer
    const asked = new Set(handles.keys())

    mediaPromise = requester
      .query(
        api.drive.nodes.media,
        {
          node: nodeId,
        },
        {
          signal: controller.signal,
          context: dependencies.context,
        },
      )
      .then(({ media }) => {
        failedReads = 0
        const seen = new Set<string>()
        for (const row of media ?? []) {
          seen.add(row.node)
          const handle = getHandle(row.node)
          handle.src.value = row.url
          handle.cacheKey.value = signatureFreeMediaKey(row.url, row.node)
          handle.status.value = 'ready'
        }
        for (const [id, handle] of handles) {
          if (!seen.has(id) && asked.has(id)) {
            handle.status.value = 'refused'
          }
        }
      })
      .catch((error) => {
        if (disposed) return

        // a passing failure says nothing about a picture, so the next read settles it
        if (!isRefusal(error)) {
          markUnanswered(asked)
          retryMedia()
          return
        }

        for (const [id, handle] of handles) {
          if (asked.has(id)) {
            handle.status.value = 'refused'
          }
        }
      })
      .finally(() => {
        mediaPromise = null

        if (hasLoadingBeyond(asked)) {
          void refreshMedia()
        }
      })
    return mediaPromise
  }

  function markUnanswered(asked: Set<string>) {
    for (const [id, handle] of handles) {
      if (asked.has(id) && handle.status.value === 'loading') {
        handle.status.value = 'unanswered'
      }
    }
  }

  function retryMedia() {
    const delay = Math.min(MEDIA_RETRY_MS * MEDIA_RETRY_GROWTH ** failedReads, MEDIA_RETRY_MAX_MS)
    failedReads += 1
    mediaRetry = setTimeout(() => void refreshMedia(), delay)
  }

  function hasLoadingBeyond(asked: Set<string>) {
    return [...handles].some(([id, handle]) => !asked.has(id) && handle.status.value === 'loading')
  }

  function getHandle(id: string): InternalMediaHandle {
    let handle = handles.get(id)
    if (!handle) {
      const src = ref<string | null>(null)
      const cacheKey = ref(`drive-media:${id}`)
      const status = ref<MediaStatus>('loading')
      handle = {
        id,
        src,
        cacheKey,
        status,
        public: {
          id,
          src: readonly(src),
          cacheKey: readonly(cacheKey),
          status: readonly(status),
          refresh: refreshMedia,
        },
      }
      handles.set(id, handle)
      void refreshMedia()
    }
    return handle
  }

  const targetWindow = dependencies.window ?? (typeof window === 'undefined' ? undefined : window)
  const setEvery = dependencies.setInterval ?? globalThis.setInterval
  const clearEvery = dependencies.clearInterval ?? globalThis.clearInterval
  const mediaTimer = setEvery(() => {
    if (handles.size) void refreshMedia()
  }, MEDIA_REFRESH_MS)
  function onOnline() {
    if (handles.size) {
      void refreshMedia()
    }
  }

  targetWindow?.addEventListener('online', onOnline)
  return {
    media: (id) => getHandle(id).public,
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      clearEvery(mediaTimer)
      clearTimeout(mediaRetry)
      targetWindow?.removeEventListener('online', onOnline)
    },
  }
}

function signatureFreeMediaKey(url: string, nodeId: string): string {
  try {
    const path = new URL(url, 'http://drive.local').pathname
    // A Frappe blob URL, `[/private]/files/<blob>/<filename>`, keys on the blob alone.
    const blobPath = path.match(/^(?:\/private)?\/files\/[0-9a-z]{10}\//)?.[0] ?? path
    return `drive-media:${blobPath}`
  } catch {
    return `drive-media:${nodeId}`
  }
}
