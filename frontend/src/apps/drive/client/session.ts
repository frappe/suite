import { computed, readonly, ref, type Ref } from 'vue'

import { onAccessChange } from './accessChanges'
import { api } from './generated'
import { driveLinks } from './links'
import { driveOperation } from './operation'
import { DRIVE_ROLES, type DriveAccess, type DriveNode } from './types'
import {
  TransportError,
  transport as defaultTransport,
  type RequestScope,
  type Transport,
} from '@/platform/transport'

export const ACCESS_REFRESH_MS = 5 * 60_000
export const MEDIA_REFRESH_MS = 10 * 60_000

export type SessionState = 'Active' | 'Trashed' | 'Refused'
export type MediaStatus = 'loading' | 'ready' | 'refused'

export interface MediaHandle {
  readonly id: string
  readonly src: Readonly<Ref<string | null>>
  readonly cacheKey: Readonly<Ref<string>>
  readonly status: Readonly<Ref<MediaStatus>>
  refresh(): Promise<void>
}

export { CredentialOverflowError } from './links'

/**
 * `fetch` with the share-link credentials of one request. The response
 * updates the link store, as a Drive request's does.
 */
export type CredentialFetch = (url: string, init?: RequestInit) => Promise<Response>

export interface CredentialGroup {
  nodeIds: string[]
  fetch: CredentialFetch
}

/**
 * Share-link credentials for requests a product sends itself. Each one
 * includes the document's own code. The Drive client selects the codes; the
 * product never sees them.
 */
export interface CredentialGrouper {
  /** Splits node ids into ordered groups that each fit one request. */
  group(nodeIds: readonly string[]): CredentialGroup[]
  /** Sends one request about the document itself. */
  fetch: CredentialFetch
  /**
   * Sends one request with every held link code, at most 20, the document's
   * own always among them. For a request that asks the server which nodes the
   * caller can open, such as a composite's manifest.
   */
  fetchHeld: CredentialFetch
}

export interface DocumentSession {
  readonly nodeId: string
  readonly contentDoctype: string
  readonly contentDocname: string
  readonly title: Readonly<Ref<string>>
  readonly state: Readonly<Ref<SessionState>>
  readonly access: Readonly<Ref<DriveAccess>>
  /** The caller may share: MANAGE (unified spec §7.2). A product shows Share only then. */
  readonly canShare: Readonly<Ref<boolean>>
  rename(title: string): Promise<DriveNode>
  /**
   * Opens the Drive share dialog. Access is read again after each write in
   * it, and once more when it closes.
   */
  share(): Promise<void>
  copy(parent: string, title?: string): Promise<DriveNode>
  comments: {
    list(resolved?: boolean): Promise<unknown>
    create(anchor: string, text: string, authorName?: string): Promise<unknown>
    reply(thread: string, text: string, authorName?: string): Promise<unknown>
    resolve(thread: string, resolved: boolean): Promise<unknown>
    edit(comment: string, text: string): Promise<unknown>
    remove(comment: string): Promise<unknown>
  }
  versions: {
    list(cursor?: string): Promise<unknown>
    create(kind?: string, label?: string): Promise<unknown>
    update(seq: string, changes: { label?: string; pinned?: boolean }): Promise<unknown>
    remove(seq: string): Promise<unknown>
    contentUrl(seq: string): string
    restore(seq: string): Promise<unknown>
  }
  media(id: string): MediaHandle
  readonly credentials: CredentialGrouper
  refreshAccess(): Promise<void>
  dispose(): void
}

/** Opens the share dialog for a node. Resolves when it closes. */
export type ShareOpener = (node: string) => Promise<void>

const openShareDialog: ShareOpener = async (node) => {
  const { presentShareDialog } = await import('@/apps/drive/files/features/share/present')
  await presentShareDialog(node)
}

interface SessionDependencies {
  transport?: Transport
  share?: ShareOpener
  window?: Window
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
}

type MediaRow = { node: string; url: string; expires: number; blob?: string }

const nodeGet = driveOperation<{ node: string; expand?: string }, DriveNode>(api.node_get, { entity: true })
const renameNode = driveOperation<{ node: string; title: string }, DriveNode>(api.node_patch.rename, { entity: true })
const copyNode = driveOperation<{ node: string; parent: string; title?: string }, DriveNode>(api.node_copy, {
  entity: true,
})
const mediaList = driveOperation<{ node: string }, { media: MediaRow[] }>(api.node_media)

export async function openDriveDocumentSession(
  nodeId: string,
  dependencies: SessionDependencies = {},
): Promise<DocumentSession> {
  const requester = dependencies.transport ?? defaultTransport
  const controller = new AbortController()
  const node = await requester.request(nodeGet, { node: nodeId, expand: 'access' }, { signal: controller.signal })
  if (!node.content_doctype || !node.content_docname) {
    throw new Error(`Drive node ${nodeId} is not a content document`)
  }
  // A node reached through a share link records no visit: Recent sends no link
  // codes, so it could never show it (spec §10.13). The same rule as
  // `isLinkOnly` in `files/features/linkAccess.ts`.
  if (!node.access?.via_link) {
    void requester
      .request(
        driveOperation<{ node: string }, Record<string, never>>(api.node_visit),
        { node: nodeId },
        { signal: controller.signal },
      )
      .catch(() => {})
  }

  const title = ref(node.title)
  const state = ref<SessionState>(toSessionState(node))
  const access = ref<DriveAccess>(node.access ?? {})
  const handles = new Map<string, InternalMediaHandle>()
  let disposed = false
  let mediaPromise: Promise<void> | null = null

  const refreshAccess = async () => {
    if (disposed) return
    try {
      const fresh = await requester.request(
        nodeGet,
        { node: nodeId, expand: 'access' },
        { signal: controller.signal },
      )
      title.value = fresh.title
      state.value = toSessionState(fresh)
      access.value = fresh.access ?? {}
    } catch {
      state.value = 'Refused'
      access.value = {}
    }
  }

  const refreshMedia = async () => {
    if (disposed) return
    if (mediaPromise) return mediaPromise
    mediaPromise = requester
      .request(mediaList, { node: nodeId }, { signal: controller.signal })
      .then(({ media }) => {
        const seen = new Set<string>()
        for (const row of media ?? []) {
          seen.add(row.node)
          const handle = getHandle(row.node)
          handle.src.value = row.url
          handle.cacheKey.value = row.blob
            ? `drive-blob:${row.blob}`
            : signatureFreeMediaKey(row.url, row.node)
          handle.status.value = 'ready'
        }
        for (const [id, handle] of handles) {
          if (!seen.has(id)) handle.status.value = 'refused'
        }
      })
      .catch(() => {
        for (const handle of handles.values()) handle.status.value = 'refused'
      })
      .finally(() => {
        mediaPromise = null
      })
    return mediaPromise
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

  const request = <Input, Output>(operation: any, input: Input) =>
    requester.request(
      driveOperation<Input, Output>(operation, { looseInput: true, covers: [nodeId] }),
      input,
      { signal: controller.signal },
    )

  const targetWindow = dependencies.window ?? (typeof window === 'undefined' ? undefined : window)
  const setEvery = dependencies.setInterval ?? globalThis.setInterval
  const clearEvery = dependencies.clearInterval ?? globalThis.clearInterval
  const accessTimer = setEvery(() => void refreshAccess(), ACCESS_REFRESH_MS)
  const mediaTimer = setEvery(() => {
    if (handles.size) void refreshMedia()
  }, MEDIA_REFRESH_MS)
  const onFocus = () => void refreshAccess()
  targetWindow?.addEventListener('focus', onFocus)
  // A share write can lower the caller's own access: react before the dialog closes.
  const stopAccessChanges = onAccessChange(nodeId, () => void refreshAccess())

  return {
    nodeId,
    contentDoctype: node.content_doctype,
    contentDocname: node.content_docname,
    title: readonly(title),
    state: readonly(state),
    access: readonly(access),
    canShare: computed(() => canShare(state.value, access.value)),
    async rename(nextTitle) {
      const updated = await requester.request(
        renameNode,
        { node: nodeId, title: nextTitle },
        { signal: controller.signal },
      )
      title.value = updated.title
      return updated
    },
    async share() {
      await (dependencies.share ?? openShareDialog)(nodeId)
      // A share write can change the caller's own access (spec §8.6).
      await refreshAccess()
    },
    copy: (parent, nextTitle) => requester.request(
      copyNode,
      { node: nodeId, parent, title: nextTitle },
      { signal: controller.signal },
    ),
    comments: {
      list: (resolved) => request(api.node_threads, { node: nodeId, resolved }),
      create: (anchor, text, authorName) =>
        request(api.node_thread_create, { node: nodeId, anchor, text, author_name: authorName }),
      reply: (thread, text, authorName) =>
        request(api.thread_comment_create, { thread, text, author_name: authorName }),
      resolve: (thread, resolved) => request(api.thread_patch, { thread, resolved }),
      edit: (comment, text) => request(api.comment_patch, { comment, text }),
      remove: (comment) => request(api.comment_delete, { comment }),
    },
    versions: {
      list: (cursor) => request(api.node_versions, { node: nodeId, cursor }),
      create: (kind, label) => request(api.node_version_create, { node: nodeId, kind, label }),
      update: (seq, changes) => request(api.node_version_patch, { node: nodeId, seq, ...changes }),
      remove: (seq) => request(api.node_version_delete, { node: nodeId, seq }),
      contentUrl: (seq) =>
        `/api/suite/drive/nodes/${encodeURIComponent(nodeId)}/versions/${encodeURIComponent(seq)}/content`,
      restore: (seq) => request(api.node_version_restore, { node: nodeId, seq }),
    },
    media: (id) => getHandle(id).public,
    credentials: documentCredentials(nodeId),
    refreshAccess,
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      clearEvery(accessTimer)
      clearEvery(mediaTimer)
      targetWindow?.removeEventListener('focus', onFocus)
      stopAccessChanges()
    },
  }
}

/** The credentials of one open document. */
export function documentCredentials(nodeId: string): CredentialGrouper {
  return {
    group: (nodeIds) =>
      driveLinks.group(nodeIds, [nodeId]).map((group) => ({
        nodeIds: group.nodeIds,
        fetch: (url, init) => fetchWith(group.scope, url, init),
      })),
    fetch: (url, init) => fetchWith(driveLinks.scope([nodeId]), url, init),
    fetchHeld: (url, init) => fetchWith(driveLinks.scopeHeld([nodeId]), url, init),
  }
}

async function fetchWith(scope: RequestScope, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(scope.headers)
  new Headers(init.headers).forEach((value, name) => headers.set(name, value))
  const response = await globalThis.fetch(url, { ...init, headers })
  if (response.ok) scope.settled?.({ ok: true, output: undefined })
  else scope.settled?.({ ok: false, error: await responseError(response) })
  return response
}

/** The error a Frappe response names: the v2 envelope type, or the v1 `exc_type`. */
async function responseError(response: Response): Promise<TransportError> {
  const body: unknown = await response.clone().json().catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const first = Array.isArray(record.errors) ? (record.errors[0] as Record<string, unknown> | undefined) : undefined
  const type = [first?.type, record.exc_type].find((value): value is string => typeof value === 'string')
  return new TransportError({ type: type ?? 'RequestError', message: response.statusText, status: response.status })
}

interface InternalMediaHandle {
  id: string
  src: Ref<string | null>
  cacheKey: Ref<string>
  status: Ref<MediaStatus>
  public: MediaHandle
}

/** Share needs MANAGE on an Active node. The server refuses a grant on a trashed one. */
export function canShare(state: SessionState, access: DriveAccess): boolean {
  return state === 'Active' && (access.role ?? 0) >= DRIVE_ROLES.manage
}

function toSessionState(node: DriveNode): SessionState {
  if ((node.access?.role ?? 0) < 10) return 'Refused'
  return node.state === 'Trashed' ? 'Trashed' : 'Active'
}

function signatureFreeMediaKey(url: string, nodeId: string): string {
  try {
    const path = new URL(url, 'http://drive.local').pathname
    const parts = path.split('/')
    const blobPath = parts[1] === 'f' && parts[2] ? `/f/${parts[2]}` : path
    return `drive-media:${blobPath}`
  } catch {
    return `drive-media:${nodeId}`
  }
}
