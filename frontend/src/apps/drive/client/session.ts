import { computed, readonly, ref, type Ref } from 'vue'

import { api, client } from '@/api'
import type { ImperativeClient } from '@/platform/server-state/types'
import { getCookieSessionUser } from '@/platform/session'
import { TransportError, type RequestContext, type RequestScope } from '@/platform/transport'

import { onAccessChange } from './accessChanges'
import { driveLinks } from './links'
import { DRIVE_ROLES, type DriveAccess, type DriveNode } from './types'

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
  readonly context: RequestContext
  nodeIds: string[]
  fetch: CredentialFetch
}

/**
 * Share-link credentials for requests a product sends itself. Each one
 * includes the document's own code. The Drive client selects the codes; the
 * product never sees them.
 */
export interface CredentialGrouper {
  readonly context: RequestContext
  readonly heldContext: RequestContext
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
    create(kind?: 'auto' | 'named' | 'milestone', label?: string): Promise<unknown>
    update(
      seq: string,
      changes: {
        label?: string
        pinned?: boolean
      },
    ): Promise<unknown>
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
  client?: ImperativeClient
  /** The node, when the caller has read it with `access` expanded. The session then opens without reading it again. */
  node?: DriveNode
  share?: ShareOpener
  window?: Window
  signedIn?: () => string | null
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
}
export async function openDriveDocumentSession(
  nodeId: string,
  dependencies: SessionDependencies = {},
): Promise<DocumentSession> {
  const requester = dependencies.client ?? client
  const signedIn = dependencies.signedIn ?? getCookieSessionUser
  const controller = new AbortController()
  const node =
    dependencies.node ??
    (await requester.query(
      api.drive.nodes.get,
      {
        node: nodeId,
        expand: 'access',
      },
      {
        signal: controller.signal,
      },
    ))
  if (!node.content_doctype || !node.content_docname) {
    throw new Error(`Drive node ${nodeId} is not a content document`)
  }
  // A node reached through a share link records no visit: Recent sends no link
  // codes, so it could never show it (spec §10.13). The same rule as
  // `isLinkOnly` in `files/features/linkAccess.ts`.
  if (!node.access?.via_link) {
    void requester
      .mutation(
        api.drive.nodes.visit,
        {
          node: nodeId,
        },
        {
          signal: controller.signal,
          silent: true,
        },
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
      const fresh = await requester.query(
        api.drive.nodes.get,
        {
          node: nodeId,
          expand: 'access',
        },
        {
          signal: controller.signal,
        },
      )
      title.value = fresh.title
      state.value = toSessionState(fresh)
      access.value = fresh.access ?? {}
    } catch (error) {
      const status = error instanceof TransportError ? error.status : 0
      const refusal = status >= 400 && status < 500
      const transient = status === 408 || status === 429
      if (!refusal || transient) return

      // A guest is refused everything; that says nothing about this person's access
      if (!signedIn()) return

      state.value = 'Refused'
      access.value = {}
    }
  }
  const refreshMedia = async () => {
    if (disposed) return
    if (mediaPromise) return mediaPromise
    mediaPromise = requester
      .query(
        api.drive.nodes.media,
        {
          node: nodeId,
        },
        {
          signal: controller.signal,
        },
      )
      .then(({ media }) => {
        const seen = new Set<string>()
        for (const row of media ?? []) {
          seen.add(row.node)
          const handle = getHandle(row.node)
          handle.src.value = row.url
          handle.cacheKey.value = signatureFreeMediaKey(row.url, row.node)
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
      const updated = await requester.mutation(
        api.drive.nodes.rename,
        {
          node: nodeId,
          title: nextTitle,
        },
        {
          signal: controller.signal,
        },
      )
      title.value = updated.title
      return updated
    },
    async share() {
      await (dependencies.share ?? openShareDialog)(nodeId)
      // A share write can change the caller's own access (spec §8.6).
      await refreshAccess()
    },
    copy: (parent, nextTitle) =>
      requester.mutation(
        api.drive.nodes.copy,
        {
          node: nodeId,
          parent_node: parent,
          title: nextTitle,
        },
        {
          signal: controller.signal,
        },
      ),
    comments: {
      list: (resolved) =>
        requester.query(
          api.drive.threads.list,
          {
            node: nodeId,
            resolved,
          },
          {
            signal: controller.signal,
          },
        ),
      create: (anchor, text, authorName) =>
        requester.mutation(
          api.drive.threads.create,
          {
            node: nodeId,
            anchor,
            text,
            author_name: authorName,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
      reply: (thread, text, authorName) =>
        requester.mutation(
          api.drive.comments.create,
          {
            node: nodeId,
            thread,
            text,
            author_name: authorName,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
      resolve: (thread, resolved) =>
        requester.mutation(
          api.drive.threads.resolve,
          {
            node: nodeId,
            thread,
            resolved,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
      edit: (comment, text) =>
        requester.mutation(
          api.drive.comments.update,
          {
            node: nodeId,
            comment,
            text,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
      remove: (comment) =>
        requester.mutation(
          api.drive.comments.delete,
          {
            node: nodeId,
            comment,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
    },
    versions: {
      list: (cursor) =>
        requester.query(
          api.drive.versions.list,
          {
            node: nodeId,
            cursor,
          },
          {
            signal: controller.signal,
          },
        ),
      create: (kind, label) =>
        requester.mutation(
          api.drive.versions.create,
          {
            node: nodeId,
            kind,
            label,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
      update: (seq, changes) =>
        requester.mutation(
          api.drive.versions.update,
          {
            node: nodeId,
            seq,
            ...changes,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
      remove: (seq) =>
        requester.mutation(
          api.drive.versions.delete,
          {
            node: nodeId,
            seq,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
      contentUrl: (seq) =>
        `/api/suite/drive/nodes/${encodeURIComponent(nodeId)}/versions/${encodeURIComponent(seq)}/content`,
      restore: (seq) =>
        requester.mutation(
          api.drive.versions.restore,
          {
            node: nodeId,
            seq,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
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
    context: {
      partition: () => driveLinks.partition([nodeId]),
      scope: () => driveLinks.scope([nodeId]),
    },
    heldContext: {
      partition: () => driveLinks.partition(),
      scope: () => driveLinks.scopeHeld([nodeId]),
    },
    group: (nodeIds) =>
      driveLinks.group(nodeIds, [nodeId]).map((group) => ({
        nodeIds: group.nodeIds,
        context: {
          partition: () => driveLinks.partition([nodeId, ...group.nodeIds]),
          scope: () => driveLinks.scope([nodeId, ...group.nodeIds]),
        },
        fetch: (url, init) => fetchWith(group.scope, url, init),
      })),
    fetch: (url, init) => fetchWith(driveLinks.scope([nodeId]), url, init),
    fetchHeld: (url, init) => fetchWith(driveLinks.scopeHeld([nodeId]), url, init),
  }
}
async function fetchWith(
  scope: RequestScope,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(scope.headers)
  new Headers(init.headers).forEach((value, name) => headers.set(name, value))
  const response = await globalThis.fetch(url, {
    ...init,
    headers,
  })
  if (response.ok)
    scope.settled?.({
      ok: true,
      output: undefined,
    })
  else
    scope.settled?.({
      ok: false,
      error: await responseError(response),
    })
  return response
}

/** The error a Frappe response names: the v2 envelope type, or the v1 `exc_type`. */
async function responseError(response: Response): Promise<TransportError> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const first = Array.isArray(record.errors)
    ? (record.errors[0] as Record<string, unknown> | undefined)
    : undefined
  const type = [first?.type, record.exc_type].find(
    (value): value is string => typeof value === 'string',
  )
  return new TransportError({
    type: type ?? 'RequestError',
    message: response.statusText,
    status: response.status,
  })
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
