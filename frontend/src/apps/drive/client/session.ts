import { computed, readonly, ref, type Ref } from 'vue'

import { api, client } from '@/api'
import type { ImperativeClient } from '@/platform/server-state/types'
import { getCookieSessionUser } from '@/platform/session'
import {
  isTransientStatus,
  MIN_SERVER_ERROR_STATUS,
  TransportError,
  type RequestContext,
  type RequestScope,
} from '@/platform/transport'

import { onAccessChange } from './accessChanges'
import type {
  NodeThreadsOutput,
  NodeThreadsOutputThreadShape,
  NodeVersionsOutput,
  NodeVersionsOutputVersionShape,
} from './generated'
import { driveLinks } from './links'
import { folderOf } from './nodes'
import { createStar } from './star'
import { canManage, type DriveAccess, type DriveBreadcrumb, type DriveNode } from './types'

export const ACCESS_REFRESH_MS = 5 * 60_000
export const MEDIA_REFRESH_MS = 10 * 60_000
const MEDIA_RETRY_MS = 2_000
const MEDIA_RETRY_GROWTH = 2
const MEDIA_RETRY_MAX_MS = 30_000
const MIN_CLIENT_ERROR_STATUS = 400
export type SessionState = 'Active' | 'Trashed' | 'Refused'
/** `unanswered`: a read for this picture failed in passing and none has answered for it yet. */
export type MediaStatus = 'loading' | 'unanswered' | 'ready' | 'refused'
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

export type DocumentThread = NodeThreadsOutputThreadShape
export type DocumentVersion = NodeVersionsOutputVersionShape

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
  /** The folder the document was in when it opened; null when the caller cannot read it. */
  readonly folder: Readonly<Ref<DriveBreadcrumb | null>>
  /** When the content last changed, as of opening. The wire's UTC time. */
  readonly editedAt: string | null
  /** The caller's own star. */
  readonly isStarred: Readonly<Ref<boolean>>
  /** Starred sends no link codes, so a node reached only through a link takes no star (spec §10.7). */
  readonly canStar: Readonly<Ref<boolean>>
  /** Shows the new state at once, and the old one again if the server refuses. */
  setStarred(starred: boolean): Promise<void>
  rename(title: string): Promise<DriveNode>
  /**
   * Opens the Drive share dialog. Access is read again after each write in
   * it, and once more when it closes.
   */
  share(): Promise<void>
  copy(parent: string, title?: string): Promise<DriveNode>
  comments: {
    list(resolved?: boolean): Promise<NodeThreadsOutput>
    /** `clientId`, made by the caller, makes a resend return the first post instead of posting twice. */
    create(
      anchor: string,
      text: string,
      authorName?: string,
      clientId?: string,
    ): Promise<{ name: string }>
    reply(thread: string, text: string, authorName?: string, clientId?: string): Promise<unknown>
    resolve(thread: string, resolved: boolean): Promise<unknown>
    edit(comment: string, text: string): Promise<unknown>
    remove(comment: string): Promise<unknown>
    /** Moves threads, by name, to new anchors; only their anchors change. */
    reanchor(anchors: Record<string, string>): Promise<unknown>
  }
  versions: {
    list(cursor?: string): Promise<NodeVersionsOutput>
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
        expand: 'access,breadcrumbs',
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
  // `isLinkOnly` in `files/features/linkAccess.ts`. A signed-out reader has no Recent.
  if (!node.access?.via_link && signedIn()) {
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
  const folder = ref<DriveBreadcrumb | null>(folderOf(node))
  const star = createStar(
    requester,
    nodeId,
    node.favourite ?? false,
    () => state.value === 'Active' && !access.value.via_link && !!signedIn(),
    controller.signal,
  )
  const handles = new Map<string, InternalMediaHandle>()
  let disposed = false
  let mediaPromise: Promise<void> | null = null
  let failedReads = 0
  let mediaRetry: ReturnType<typeof setTimeout> | undefined
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
      star.isStarred.value = fresh.favourite ?? false
    } catch (error) {
      if (!isRefusal(error)) return

      // A guest is refused everything; that says nothing about this person's access
      if (!signedIn()) return

      state.value = 'Refused'
      access.value = {}
    }
  }
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
  const accessTimer = setEvery(() => void refreshAccess(), ACCESS_REFRESH_MS)
  const mediaTimer = setEvery(() => {
    if (handles.size) void refreshMedia()
  }, MEDIA_REFRESH_MS)
  const onFocus = () => void refreshAccess()
  targetWindow?.addEventListener('focus', onFocus)
  function onOnline() {
    if (handles.size) {
      void refreshMedia()
    }
  }

  targetWindow?.addEventListener('online', onOnline)
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
    folder: readonly(folder),
    editedAt: node.content_modified ?? node.modified,
    ...star,
    async rename(nextTitle) {
      const updated = await requester.mutation(
        api.drive.nodes.rename,
        {
          node: nodeId,
          title: nextTitle,
        },
        {
          signal: controller.signal,
          // The header shows the refusal beside the title, so no toast too.
          silent: true,
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
      create: (anchor, text, authorName, clientId) =>
        requester.mutation(
          api.drive.threads.create,
          {
            node: nodeId,
            anchor,
            text,
            author_name: authorName,
            client_id: clientId,
          },
          {
            signal: controller.signal,
            silent: true,
          },
        ),
      reply: (thread, text, authorName, clientId) =>
        requester.mutation(
          api.drive.comments.create,
          {
            node: nodeId,
            thread,
            text,
            author_name: authorName,
            client_id: clientId,
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
      reanchor: (anchors) =>
        requester.mutation(
          api.drive.threads.reanchor,
          {
            node: nodeId,
            anchors,
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
      clearTimeout(mediaRetry)
      targetWindow?.removeEventListener('focus', onFocus)
      targetWindow?.removeEventListener('online', onOnline)
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
  return state === 'Active' && canManage({ access })
}

// the server turned the request away, unlike a network or server failure that passes
function isRefusal(error: unknown): boolean {
  if (!(error instanceof TransportError)) {
    return false
  }

  const { status } = error
  return (
    status >= MIN_CLIENT_ERROR_STATUS &&
    status < MIN_SERVER_ERROR_STATUS &&
    !isTransientStatus(status)
  )
}
function toSessionState(node: DriveNode): SessionState {
  if ((node.access?.role ?? 0) < 10) return 'Refused'
  return node.state === 'Trashed' ? 'Trashed' : 'Active'
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
