import { defineAsyncComponent, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RouteLocationPathRaw } from 'vue-router'

import FilesIcon from '@/apps/drive/AreaIcon.vue'
import { api } from '@/apps/drive/client/generated'
import { createGuestCommentName, type GuestCommentName } from '@/apps/drive/client/guestName'
import { driveLinks } from '@/apps/drive/client/links'
import { createDocument, recordVisit } from '@/apps/drive/client/nodes'
import { driveOperation } from '@/apps/drive/client/operation'
import { roots } from '@/apps/drive/client/roots'
import { openDriveDocumentSession } from '@/apps/drive/client/session'
import type { DriveNode } from '@/apps/drive/client/types'
import { recents } from '@/apps/drive/client/views'
import { presentDialog, rememberDialogContext } from '@/apps/drive/files/features/dialogHost'
import { observePreviewRefresh } from '@/apps/drive/files/features/previewRefresh'
import { slugify } from '@/apps/drive/files/internal/slugify'
import type { AreaDefinition } from '@/platform/contracts'
import { openingTitleState } from '@/platform/page-meta'
import { useMutation, useQuery } from '@/platform/server-state'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { transport } from '@/platform/transport'

export type {
  CredentialGroup,
  CredentialGrouper,
  DocumentSession,
  MediaHandle,
  MediaStatus,
  SessionState,
} from '@/apps/drive/client/session'
export { CredentialOverflowError } from '@/apps/drive/client/links'

/** Remembers the share link a `#link=` fragment carried, for the node it opened. */
export function rememberDriveLink(token: string, node: string): void {
  driveLinks.seed(token, node)
}

/** The "Your name" field of a comment composer. Call it in a component's setup (spec §10.5). */
export function useDriveGuestName(): GuestCommentName {
  return createGuestCommentName(driveLinks, useSession())
}

export { GUEST_NAME_LIMIT, type GuestCommentName } from '@/apps/drive/client/guestName'

/** A comment's author: a guest's name and the Guest marker, or the product's own label in the slot. */
export { default as DriveCommentAuthor } from '@/apps/drive/files/features/CommentAuthor.vue'

/**
 * A file's card, as Drive's grid shows it. Pass `node` and `meta`. The card picks
 * the type icon, and shows the thumbnail once it loads when the node carries one.
 * Emits `preview-error` once per file when a thumbnail fails: refetch for a fresh URL.
 */
export { default as DriveFileCard } from '@/apps/drive/files/features/FileCard.vue'

/**
 * Keeps the signed thumbnail URLs on a card grid fresh while the calling
 * component is mounted: every 10 minutes, and when the tab is shown again.
 * Call it in a component's setup.
 */
export function useDrivePreviewRefresh(refresh: () => unknown): void {
  let stop: (() => void) | undefined
  onMounted(() => {
    stop = observePreviewRefresh({
      refresh: async () => {
        await refresh()
      },
    })
  })
  onBeforeUnmount(() => stop?.())
}

/** A file's date as Drive's listing shows it: `Just now`, `5 min ago`, `Yesterday`, then the day. */
export { formatModified as formatDriveListingDate } from '@/apps/drive/files/internal/format'

/** A server stamp (RFC 3339 in UTC, Drive spec §11.3) as a full date and time in the viewer's zone. */
export { formatDate as formatDriveDateTime } from '@/apps/drive/files/internal/format'

/** The caller's Drive notifications: the feed, the unread count, and the two read receipts (spec §9.5). */
export {
  markAllNotificationsRead as markAllDriveNotificationsRead,
  markNotificationsRead as markDriveNotificationsRead,
  notifications as driveNotifications,
  unreadCount as driveUnreadNotificationCount,
  type DriveNotification,
} from '@/apps/drive/client/notifications'

const summaryRead = driveOperation<{ node: string }, DriveNode>(api.node_get)

/** One readable node's summary, outside the cache: for a route a notification opens. */
export function loadDriveNodeSummary(node: string): Promise<DriveNodeSummary> {
  return transport.request(summaryRead, { node })
}

export type DriveNodeSummary = Pick<
  DriveNode,
  | 'name'
  | 'title'
  | 'kind'
  | 'mime'
  | 'content_doctype'
  | 'content_docname'
  | 'state'
  | 'access'
  | 'preview'
  | 'opened_at'
  | 'favourite'
>

export const filesArea: AreaDefinition = {
  id: 'files',
  label: () => __('Drive'),
  icon: FilesIcon,
  to: '/drive',
  loadRoutes: () => import('@/apps/drive/files/pages/routes'),
}

/** Drive's Settings group. Loads when Settings opens. */
export const loadDriveSettings = () =>
  import('@/apps/drive/files/features/settings/settingsGroup').then((module) =>
    module.driveSettings(),
  )

/** The caller's recently opened nodes, newest first, with thumbnails for `DriveFileCard`. */
export function driveRecents(limit = 12) {
  return recents({ limit, expand: 'preview' })
}

export interface DriveDocumentCreation {
  readonly isPending: boolean
  /** Creates a document of this content doctype in My files. `undefined` when it failed. */
  run(input: { content_doctype: string }): Promise<DriveNodeSummary | undefined>
}

/** Generic document creation into the caller's Personal Root. Call it in a component's setup. */
export function useDriveDocumentCreation(): DriveDocumentCreation {
  const discovered = useQuery(roots())
  const create = useMutation(createDocument())
  const resolving = ref(false)
  return {
    get isPending() {
      return resolving.value || create.isPending
    },
    async run({ content_doctype }) {
      resolving.value = true
      let parent: string | undefined
      try {
        parent = (discovered.data ?? (await discovered.settled()).data)?.personal.node
      } finally {
        resolving.value = false
      }
      if (!parent) {
        const message = discovered.error?.message ?? __('My files is unavailable.')
        // Loaded on demand: `@/platform/feedback` pulls frappe-ui into the initial graph.
        void import('@/platform/feedback').then(({ toast }) => toast.error(message))
        return undefined
      }
      return create.run({ parent_node: parent, content_doctype })
    },
  }
}

/** Records that the caller opened a node, so it shows in Recent. */
export function recordDriveVisit(node: string): Promise<void> {
  return recordVisit(node)
}

export function driveNodeRoute(
  node: DriveNodeSummary | { name: string; title: string; kind: string } | string,
  title?: string,
  kind = 'document',
): RouteLocationPathRaw {
  const id = typeof node === 'string' ? node : node.name
  const label = typeof node === 'string' ? (title ?? '') : node.title
  const nodeKind = typeof node === 'string' ? kind : node.kind
  const slug = slugify(label)
  const base =
    nodeKind === 'folder' ? `/drive/f/${encodeURIComponent(id)}` : `/d/${encodeURIComponent(id)}`
  // The history entry carries the title, so the tab names the node before
  // its page loads.
  return { path: `${base}${slug ? `/${slug}` : ''}`, state: openingTitleState(label) }
}

/** What a document session and a file preview session each need of the node, so one read opens either. */
const OPENING_EXPAND = 'access,preview,breadcrumbs'
const openingRead = driveOperation<{ node: string; expand: string }, DriveNode>(api.node_get, {
  entity: true,
})

export async function openDocumentSession(nodeId: string) {
  // `session.share()` opens its dialog in the app that opened the session.
  rememberDialogContext(getCurrentInstance()?.appContext)
  // Every surface shows the document header: fetch it while the session opens.
  void loadDocumentHeader()
  const node = await transport.request(openingRead, { node: nodeId, expand: OPENING_EXPAND })
  if (node.content_doctype && node.content_docname)
    return openDriveDocumentSession(nodeId, { node })
  const { openFilePreviewSession } = await import('@/apps/drive/files/features/preview/session')
  return openFilePreviewSession(nodeId, node)
}

export { isDriveLocked, isDriveNodeLocked } from '@/apps/drive/client/unlock'

/** The upload queue for the app root: the shell's indicator, the tracker's state and the queue's questions (spec §6.3). */
export {
  driveUploadProgress,
  type DriveUploadProgress,
} from '@/apps/drive/files/features/uploads/progress'

/** The upload tracker. The app root mounts it while the queue has work, so it outlives the page. */
export const DriveUploadTracker = defineAsyncComponent(
  () => import('@/apps/drive/files/features/uploads/UploadTracker.vue'),
)

/** The password screen a node route shows in place on `401 DriveLocked` (spec §10.2). Emits `unlocked`. */
export const DriveUnlockScreen = defineAsyncComponent(
  () => import('@/apps/drive/files/features/UnlockScreen.vue'),
)

const loadDocumentHeader = () => import('@/apps/drive/files/features/document/DocumentHeader.vue')

/**
 * The header every document surface shows: type icon, title, save status, the
 * surface's actions, side-panel toggles and Share. Pass `session`, `title-label`,
 * and optionally `save-state`, `view-only`, `recoverable` with
 * `@download-changes`, `panels` with `v-model:panel`, `location`, and `mime`
 * for a file. Slots: `status` (after the badges) and `actions` (before the
 * panel toggles). Exposes `focusTitle()`.
 */
export const DriveDocumentHeader = defineAsyncComponent(loadDocumentHeader)

/** The document header's shape while a document opens. Shows `title` when one is known. */
export { default as DriveDocumentHeaderSkeleton } from '@/apps/drive/files/features/document/DocumentHeaderSkeleton.vue'

export type { DocumentPanel, DocumentSaveState } from '@/apps/drive/files/features/document/header'

export const filePreviewSurface = defineAsyncComponent(
  () => import('@/apps/drive/files/features/preview/FilePreviewSurface.vue'),
)

export interface DriveDialogs {
  /** Opens the folder picker to move `node`. Resolves with the moved node, or `undefined` when cancelled. */
  move(node: string): Promise<DriveNodeSummary | undefined>
  /** Shows read-only details of `node`. Resolves when the dialog closes. */
  showDetails(node: string): Promise<void>
  /** Opens the share dialog for `node`. Resolves when it closes: `true` when a write in it went through. */
  share(node: string): Promise<boolean>
}

/** Drive dialogs, opened by function call. Call it in a component's setup. */
export function useDriveDialogs(): DriveDialogs {
  const context = getCurrentInstance()?.appContext
  if (!context) throw new Error('useDriveDialogs() must be called in a component setup')
  return {
    move: (node) =>
      presentDialog<DriveNodeSummary>(
        context,
        () => import('@/apps/drive/files/features/MoveNodeDialog.vue'),
        { node },
        'moved',
      ),
    showDetails: async (node) => {
      await presentDialog(context, () => import('@/apps/drive/files/features/NodeInfoDialog.vue'), {
        node,
      })
    },
    share: (node) =>
      import('@/apps/drive/files/features/share/present').then((share) =>
        share.presentShareDialog(node, context),
      ),
  }
}
