import { computed, readonly, ref, type Ref } from 'vue'

import { api, client, onTouch } from '@/api'
import { onAccessChange } from '@/apps/drive/client/accessChanges'
import {
  canShare,
  documentCredentials,
  type DocumentSession,
  type MediaHandle,
} from '@/apps/drive/client/session'
import type { DriveBreadcrumb, DriveNode, DrivePreview } from '@/apps/drive/client/types'

import { presentShareDialog } from '../share/present'

const EXPAND = 'access,preview,breadcrumbs'
export interface FilePreviewSession extends DocumentSession {
  readonly mime: string | null
  /** The file's size in bytes. Follows a new version. */
  readonly size: Readonly<Ref<number>>
  /** The id of the folder the file is in. A replace names it; `null` for a root. Follows a move. */
  readonly parent: Readonly<Ref<string | null>>
  /**
   * The folder the file is in, when the caller can read it: the header links
   * back to it. Follows a move.
   */
  readonly folder: Readonly<Ref<DriveBreadcrumb | null>>
  /** The root the file is in. A restore whose folder is gone picks a folder in it. */
  readonly root: string
  /** The node whose trashing trashed the file: the file itself, a folder it is in, or `null` while Active. Follows a refresh. */
  readonly trashRoot: Readonly<Ref<string | null>>
  readonly preview: Readonly<Ref<DrivePreview | null>>
  /**
   * The caller's own star on the file. Writable, so a star toggle can show
   * the new state before the server answers and put it back on a refusal.
   */
  readonly favourite: Ref<boolean>
  refreshPreview(): Promise<void>
}

/**
 * Opens a file for preview. `node` is the file when the caller has read it with
 * `access,preview,breadcrumbs` expanded, so the session opens without reading it again.
 */
export async function openFilePreviewSession(
  nodeId: string,
  node?: DriveNode,
): Promise<FilePreviewSession> {
  const controller = new AbortController()
  const initial =
    node ??
    (await client.query(
      api.drive.nodes.get,
      {
        node: nodeId,
        expand: EXPAND,
      },
      {
        signal: controller.signal,
      },
    ))
  if (initial.kind !== 'file' || initial.content_doctype || initial.content_docname) {
    throw new Error(`Drive node ${nodeId} is not a previewable file`)
  }
  const title = ref(initial.title)
  const state = ref<'Active' | 'Trashed' | 'Refused'>(sessionState(initial))
  const access = ref(initial.access ?? {})
  const preview = ref<DrivePreview | null>(initial.preview ?? null)
  const parent = ref(initial.parent_node)
  const folder = ref<DriveBreadcrumb | null>(folderOf(initial))
  const trashRoot = ref(initial.trash_root)
  const favourite = ref(initial.favourite ?? false)
  const size = ref(initial.size)
  let disposed = false
  /** Counts reads, so an answer that comes back after a newer one never puts older state back. */
  let reads = 0

  // A file reached through a share link records no visit (spec §10.13): the
  // same rule as the document session and `isLinkOnly`.
  if (!initial.access?.via_link)
    void client
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
  async function refresh() {
    if (disposed) return
    const read = ++reads
    try {
      const node = await client.query(
        api.drive.nodes.get,
        {
          node: nodeId,
          expand: EXPAND,
        },
        {
          signal: controller.signal,
        },
      )
      if (read !== reads) return
      title.value = node.title
      parent.value = node.parent_node
      folder.value = folderOf(node)
      trashRoot.value = node.trash_root
      access.value = node.access ?? {}
      state.value = sessionState(node)
      preview.value = node.preview ?? null
      favourite.value = node.favourite ?? false
      size.value = node.size
    } catch {
      if (read !== reads || disposed) return
      state.value = 'Refused'
      access.value = {}
      preview.value = null
    }
  }
  const media: MediaHandle = {
    id: nodeId,
    src: readonly(ref(initial.url)),
    cacheKey: readonly(ref(`drive-file:${nodeId}`)),
    status: readonly(ref(initial.url ? 'ready' : 'refused')),
    refresh,
  }
  const accessTimer = window.setInterval(() => void refresh(), 5 * 60_000)
  const previewTimer = window.setInterval(() => void refresh(), 10 * 60_000)
  const onFocus = () => void refresh()
  window.addEventListener('focus', onFocus)
  const stopAccessChanges = onAccessChange(nodeId, () => void refresh())
  // A move, trash, restore or undo made anywhere names the file in `touches`.
  const stopTouches = onTouch(nodeId, () => void refresh())
  return {
    nodeId,
    contentDoctype: 'File',
    contentDocname: nodeId,
    mime: initial.mime,
    size: readonly(size),
    parent: readonly(parent),
    folder: readonly(folder),
    root: initial.root,
    trashRoot: readonly(trashRoot),
    preview: readonly(preview),
    favourite,
    title: readonly(title),
    state: readonly(state),
    access: readonly(access),
    canShare: computed(() => canShare(state.value, access.value)),
    async rename(nextTitle) {
      const node = await client.mutation(
        api.drive.nodes.rename,
        {
          node: nodeId,
          title: nextTitle,
        },
        {
          signal: controller.signal,
        },
      )
      // A read already on its way may predate the rename, so its answer is dropped.
      reads += 1
      title.value = node.title
      return node
    },
    async share() {
      await presentShareDialog(nodeId)
      await refresh()
    },
    copy: (parent, nextTitle) =>
      client.mutation(
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
        client.query(
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
        client.mutation(
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
        client.mutation(
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
        client.mutation(
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
        client.mutation(
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
        client.mutation(
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
        client.query(
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
        client.mutation(
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
        client.mutation(
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
        client.mutation(
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
        client.mutation(
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
    media: () => media,
    credentials: documentCredentials(nodeId),
    refreshAccess: refresh,
    refreshPreview: refresh,
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      window.clearInterval(accessTimer)
      window.clearInterval(previewTimer)
      window.removeEventListener('focus', onFocus)
      stopAccessChanges()
      stopTouches()
    },
  }
}

/** Kinds of node that hold files in a listing a preview can step through. */
const FOLDER_KINDS = new Set(['folder', 'root'])

/**
 * The breadcrumbs end at the file's own folder, when the caller can read it.
 * A picture inside a Writer document or a Slides deck has no folder: the
 * document is its parent, and a document is never listed as a folder.
 */
function folderOf(node: DriveNode): DriveBreadcrumb | null {
  const trail = node.breadcrumbs ?? []
  const parent = trail.at(-1)
  if (!parent || parent.name !== node.parent_node || !FOLDER_KINDS.has(parent.kind)) return null
  return trail.some((step) => step.kind === 'document') ? null : parent
}
function sessionState(node: DriveNode): 'Active' | 'Trashed' | 'Refused' {
  if ((node.access?.role ?? 0) < 10) return 'Refused'
  return node.state === 'Trashed' ? 'Trashed' : 'Active'
}
