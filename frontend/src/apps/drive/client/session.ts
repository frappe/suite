import { readonly, ref, type Ref } from 'vue'

import { api } from './generated'
import { driveOperation } from './operation'
import type { DriveAccess, DriveNode } from './types'
import { transport as defaultTransport, type Transport } from '@/platform/transport'

export const ACCESS_REFRESH_MS = 5 * 60_000
export const MEDIA_REFRESH_MS = 10 * 60_000
export const CREDENTIAL_CAP = 20

export type SessionState = 'Active' | 'Trashed' | 'Refused'
export type MediaStatus = 'loading' | 'ready' | 'refused'

export interface MediaHandle {
  readonly id: string
  readonly src: Readonly<Ref<string | null>>
  readonly cacheKey: Readonly<Ref<string>>
  readonly status: Readonly<Ref<MediaStatus>>
  refresh(): Promise<void>
}

export interface CredentialGroup {
  nodeIds: string[]
  /** For product-private connection payloads. Do not render or persist. */
  codes: string[]
}

export class CredentialOverflowError extends Error {
  readonly type = 'DriveCredentialOverflow'

  constructor(readonly nodeId: string, readonly count: number) {
    super(`Drive node ${nodeId} needs ${count} link codes. The limit is ${CREDENTIAL_CAP}.`)
  }
}

export interface CredentialGrouper {
  group(nodeIds: readonly string[]): Promise<CredentialGroup[]>
  codesFor(nodeIds: readonly string[]): Promise<readonly string[]>
}

export interface UnavailableShare {
  available: false
  title: string
  reason: string
}

export interface DocumentSession {
  readonly nodeId: string
  readonly contentDoctype: string
  readonly contentDocname: string
  readonly title: Readonly<Ref<string>>
  readonly state: Readonly<Ref<SessionState>>
  readonly access: Readonly<Ref<DriveAccess>>
  rename(title: string): Promise<DriveNode>
  share(): Promise<UnavailableShare>
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

interface SessionDependencies {
  transport?: Transport
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
  void requester
    .request(
      driveOperation<{ node: string }, Record<string, never>>(api.node_visit),
      { node: nodeId },
      { signal: controller.signal },
    )
    .catch(() => {})

  const title = ref(node.title)
  const state = ref<SessionState>(toSessionState(node))
  const access = ref<DriveAccess>(node.access ?? {})
  const handles = new Map<string, InternalMediaHandle>()
  const credentialsByNode = new Map<string, string[]>()
  let disposed = false
  let mediaPromise: Promise<void> | null = null

  rememberCredential(node)

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
      rememberCredential(fresh)
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

  function rememberCredential(value: DriveNode): void {
    const held = value.access?.via_link
    if (held && held.startsWith('$LINK:')) credentialsByNode.set(value.name, [held.slice(6)])
  }

  const credentials: CredentialGrouper = {
    async group(nodeIds) {
      for (const id of new Set(nodeIds)) {
        if (credentialsByNode.has(id)) continue
        try {
          rememberCredential(
            await requester.request(nodeGet, { node: id, expand: 'access' }, { signal: controller.signal }),
          )
        } catch {
          credentialsByNode.set(id, [])
        }
      }
      const groups: CredentialGroup[] = []
      let current: CredentialGroup = { nodeIds: [], codes: [] }
      for (const id of nodeIds) {
        const codes = credentialsByNode.get(id) ?? []
        if (codes.length > CREDENTIAL_CAP) throw new CredentialOverflowError(id, codes.length)
        const combined = [...new Set([...current.codes, ...codes])]
        if (current.nodeIds.length && combined.length > CREDENTIAL_CAP) {
          groups.push(current)
          current = { nodeIds: [], codes: [] }
        }
        current.nodeIds.push(id)
        current.codes = [...new Set([...current.codes, ...codes])]
      }
      if (current.nodeIds.length) groups.push(current)
      return groups
    },
    async codesFor(nodeIds) {
      const groups = await this.group(nodeIds)
      if (groups.length > 1) throw new CredentialOverflowError(nodeIds.join(','), groups.flatMap((g) => g.codes).length)
      return groups[0]?.codes ?? []
    },
  }

  const request = <Input, Output>(operation: any, input: Input) =>
    requester.request(
      driveOperation<Input, Output>(operation, { looseInput: true }),
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

  return {
    nodeId,
    contentDoctype: node.content_doctype,
    contentDocname: node.content_docname,
    title: readonly(title),
    state: readonly(state),
    access: readonly(access),
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
      await refreshAccess()
      return {
        available: false,
        title: 'Sharing is unavailable',
        reason: 'The Drive sharing workflow is coming in ticket 008.',
      }
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
    credentials,
    refreshAccess,
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      clearEvery(accessTimer)
      clearEvery(mediaTimer)
      targetWindow?.removeEventListener('focus', onFocus)
    },
  }
}

interface InternalMediaHandle {
  id: string
  src: Ref<string | null>
  cacheKey: Ref<string>
  status: Ref<MediaStatus>
  public: MediaHandle
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
