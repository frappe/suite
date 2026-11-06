import {
  computed,
  defineAsyncComponent,
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComputedRef,
} from 'vue'
import { useRouter, type RouteLocationPathRaw, type Router } from 'vue-router'

import { api, client, useQuery } from '@/api'
import FilesIcon from '@/apps/drive/AreaIcon.vue'
import { createGuestCommentName, type GuestCommentName } from '@/apps/drive/client/guestName'
import { driveLinks } from '@/apps/drive/client/links'
import { createDocument, recordVisit } from '@/apps/drive/client/nodes'
import { openDriveDocumentSession, type DocumentSession } from '@/apps/drive/client/session'
import { DRIVE_ROLES, type DriveBreadcrumb, type DriveNode } from '@/apps/drive/client/types'
import { announceTrash } from '@/apps/drive/files/features/changeToast'
import { presentDialog, rememberDialogContext } from '@/apps/drive/files/features/dialogHost'
import { nodeActions, type ActionNode } from '@/apps/drive/files/features/nodeActions'
import { observePreviewRefresh } from '@/apps/drive/files/features/previewRefresh'
import { usePaletteSearch } from '@/apps/drive/files/features/usePaletteSearch'
import { useLocationTitle } from '@/apps/drive/files/internal/locations'
import { slugify } from '@/apps/drive/files/internal/slugify'
import type { AreaDefinition, PaletteSearchSource } from '@/platform/contracts'
import { toast } from '@/platform/feedback'
import { newDocumentState, openingTitleState } from '@/platform/page-meta'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { buildUrl } from '@/platform/transport'

export type {
  CredentialGroup,
  CredentialGrouper,
  DocumentSession,
  DocumentThread,
  DocumentVersion,
  MediaHandle,
  MediaStatus,
  SessionState,
} from '@/apps/drive/client/session'
export { CredentialOverflowError } from '@/apps/drive/client/links'
export { documentCredentials } from '@/apps/drive/client/session'
export { hasDefaultDocumentTitle, nodeContentUrl } from '@/apps/drive/client/nodes'

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
 * component is mounted: shortly before the earliest of `rows` expires.
 * Call it in a component's setup.
 */
export function useDrivePreviewRefresh(
  refresh: () => unknown,
  rows: () => readonly Pick<DriveNodeSummary, 'preview'>[],
): void {
  let stop: (() => void) | undefined
  onMounted(() => {
    stop = observePreviewRefresh({
      refresh: async () => {
        await refresh()
      },
      rows,
    })
  })
  onBeforeUnmount(() => stop?.())
}

/** A file's date as Drive's listing shows it: `Just now`, `5 min ago`, `Yesterday`, then the day. */
export { formatModified as formatDriveListingDate } from '@/apps/drive/files/internal/format'

/** A server stamp (RFC 3339 in UTC, Drive spec §11.3) as a full date and time in the viewer's zone. */
export { formatDate as formatDriveDateTime } from '@/apps/drive/files/internal/format'
export { formatBytes as formatDriveBytes } from '@/apps/drive/files/internal/format'

/** A document type's icon and its ink, as Drive's listings draw it. */
export { documentIcon as driveDocumentIcon } from '@/apps/drive/files/internal/icons'

export type { DriveNotification } from '@/apps/drive/client/notifications'
export { DRIVE_ROLES } from '@/apps/drive/client/types'

/** One readable node's summary, for a route a notification opens. */
export function loadDriveNodeSummary(node: string): Promise<DriveNodeSummary> {
  return client.query(api.drive.nodes.get, { node })
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

export { RECOVERY_COPIES_TITLE } from '@/apps/drive/files/pages/recoveryCopies'

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

export interface DriveDocumentCreation {
  readonly isPending: boolean
  /** Creates a document of this content doctype in My files. Refusals reject. */
  run(input: { content_doctype: string }): Promise<DriveNodeSummary>
}

/** Generic document creation into the caller's Personal Root. Call it in a component's setup. */
export function useDriveDocumentCreation(): DriveDocumentCreation {
  const discovered = useQuery(api.drive.roots.list, {})
  const creating = ref(false)
  const resolving = ref(false)
  return {
    get isPending() {
      return resolving.value || creating.value
    },
    async run({ content_doctype }) {
      resolving.value = true
      let parent: string | undefined
      try {
        parent = (discovered.data ?? (await discovered.refetch()))?.personal.node
      } finally {
        resolving.value = false
      }
      if (!parent) {
        const message = discovered.error?.message ?? __('My files is unavailable.')
        // Loaded on demand: `@/platform/feedback` pulls frappe-ui into the initial graph.
        void import('@/platform/feedback').then(({ toast }) => toast.error(message))
        throw new Error(message)
      }
      creating.value = true
      try {
        return await createDocument({ parent_node: parent, content_doctype })
      } finally {
        creating.value = false
      }
    },
  }
}

/** Records that the caller opened a node, so it shows in Recent. */
export function recordDriveVisit(node: string): Promise<void> {
  return recordVisit(node)
}

/** The segments a document's own views take after /d/<node>, so no slug can name one. */
export const DOCUMENT_VIEW_SEGMENTS = ['present']

export function driveNodeRoute(
  node: DriveNodeSummary | { name: string; title: string; kind: string } | string,
  title?: string,
  kind = 'document',
): RouteLocationPathRaw {
  const id = typeof node === 'string' ? node : node.name
  const label = typeof node === 'string' ? (title ?? '') : node.title
  const nodeKind = typeof node === 'string' ? kind : node.kind
  const isFolder = nodeKind === 'folder'
  const titleSlug = slugify(label)
  const slug = !isFolder && DOCUMENT_VIEW_SEGMENTS.includes(titleSlug) ? '' : titleSlug
  const prefix = isFolder ? '/drive/f' : '/d'
  const address = encodeURIComponent(id)
  const base = `${prefix}/${address}`
  // The history entry carries the title, so the tab names the node before
  // its page loads.
  return { path: `${base}${slug ? `/${slug}` : ''}`, state: openingTitleState(label) }
}

/** Drive's nodes by name, for the command palette on pages with no search of their own. */
export const drivePaletteSearch: PaletteSearchSource = {
  label: () => __('Drive'),
  use: (term) => usePaletteSearch(term, driveNodeRoute),
}

/** Opens a document this tab has just created. Its page takes typing before the document loads. */
export function newDocumentRoute(node: DriveNodeSummary): RouteLocationPathRaw {
  const route = driveNodeRoute(node)
  const marked = node.content_doctype ? newDocumentState(node.content_doctype) : {}
  return { ...route, query: { new: '1' }, state: { ...route.state, ...marked } }
}

/** A document menu item, in frappe-ui Dropdown's shape. */
export interface DriveDocumentAction {
  label: string
  icon: string
  onClick: () => void
}

/**
 * A document's own Drive actions for its menu: `back` to the folder it is in,
 * and its `node` actions, Duplicate and Delete. Each shows only when the caller
 * may take it: Duplicate copies into the folder, so it needs UPLOAD there.
 * Call it in a component's setup.
 */
export function useDriveDocumentActions(
  session: DocumentSession,
): ComputedRef<{ back: DriveDocumentAction[]; node: DriveDocumentAction[] }> {
  const account = useSession()
  const actions = documentActions(session)
  return computed(() => {
    const folder = session.folder.value
    const can = nodeActions(actionNodeOf(session), account.status.value === 'authenticated')
    const canUploadToFolder = folder !== null && folder.role >= DRIVE_ROLES.upload
    return {
      back: actionsWhere([[folder !== null, actions.back]]),
      node: actionsWhere([
        [canUploadToFolder && can.copy, actions.duplicate],
        [can.trash, actions.delete],
      ]),
    }
  })
}

function documentActions(session: DocumentSession) {
  const router = useRouter()
  const locationTitle = useLocationTitle()
  function folderRoute() {
    return folderRouteOf(session.folder.value, locationTitle)
  }

  return {
    back: {
      label: __('Back to folder'),
      icon: 'lucide-arrow-left',
      onClick: () => void router.push(folderRoute()),
    },
    duplicate: {
      label: __('Duplicate'),
      icon: 'lucide-copy',
      onClick: () => void duplicateDocument(session, session.folder.value, router),
    },
    delete: {
      label: __('Delete'),
      icon: 'lucide-trash-2',
      onClick: () => void trashDocument(session, router, folderRoute()),
    },
  }
}

function folderRouteOf(
  folder: DriveBreadcrumb | null,
  locationTitle: (crumb: DriveBreadcrumb) => string,
): RouteLocationPathRaw {
  if (!folder) {
    return { path: '/drive' }
  }

  return driveNodeRoute(folder.name, locationTitle(folder), 'folder')
}

async function duplicateDocument(
  session: DocumentSession,
  folder: DriveBreadcrumb | null,
  router: Router,
) {
  if (!folder) {
    return
  }

  try {
    await router.push(driveNodeRoute(await session.copy(folder.name)))
  } catch (error) {
    toast.error((error instanceof Error && error.message) || __('Could not duplicate this file.'))
  }
}

async function trashDocument(session: DocumentSession, router: Router, back: RouteLocationPathRaw) {
  const item = { node: session.nodeId, title: session.title.value }
  try {
    await client.mutation(api.drive.nodes.trash, { node: item.node, state: 'Trashed' })
  } catch (error) {
    toast.error((error instanceof Error && error.message) || __('Could not delete this file.'))
    return
  }

  announceTrash([item])
  await router.push(back)
}

function actionNodeOf(session: DocumentSession): ActionNode {
  return {
    name: session.nodeId,
    kind: 'document',
    state: session.state.value,
    trash_root: null,
    access: session.access.value,
  }
}

function actionsWhere(items: [boolean, DriveDocumentAction][]): DriveDocumentAction[] {
  return items.flatMap(([isShown, action]) => (isShown ? [action] : []))
}

/** What a document session and a file preview session each need of the node, so one read opens either. */
const OPENING_EXPAND = 'access,preview,breadcrumbs'
/** The urls opening a document session reads, for a copy that opens it offline. */
export function documentSessionUrls(nodeId: string): string[] {
  return [
    buildUrl(api.drive.nodes.get, { node: nodeId, expand: OPENING_EXPAND }),
    buildUrl(api.drive.nodes.media, { node: nodeId }),
  ]
}
export async function openDocumentSession(nodeId: string) {
  // `session.share()` opens its dialog in the app that opened the session.
  rememberDialogContext(getCurrentInstance()?.appContext)
  // Every surface shows the document header: fetch it while the session opens.
  void loadDocumentHeader()
  const node = await client.query(api.drive.nodes.get, { node: nodeId, expand: OPENING_EXPAND })
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

/** Evaluation scaffolding: the panel that switches each Drive UI change on or off. The app root mounts it on Drive routes. */
export const DriveTweakPanel = defineAsyncComponent(
  () => import('@/apps/drive/files/features/tweaks/TweakPanel.vue'),
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
 * panel toggles). Exposes `focusTitle()` and `focusPanelToggle(name)`.
 */
export const DriveDocumentHeader = defineAsyncComponent(loadDocumentHeader)

/** True while a listing's load is too new for placeholder rows, as Drive waits before drawing them. */
export { useSkeletonDelay as useDriveSkeletonDelay } from '@/apps/drive/files/features/listSkeleton'
export type { SkeletonCell as DriveSkeletonCell } from '@/apps/drive/files/features/listSkeleton'

/** Placeholder rows inside a List, as Drive's listing draws them; `cells` sit between the name and the actions. */
export const DriveListSkeletonRows = defineAsyncComponent(
  () => import('@/apps/drive/files/features/ListSkeletonRows.vue'),
)

/** The document header's shape while a document opens. Shows `title` when one is known. */
export { default as DriveDocumentHeaderSkeleton } from '@/apps/drive/files/features/document/DocumentHeaderSkeleton.vue'

export { PANEL_BUTTONS } from '@/apps/drive/files/features/document/header'
export type { DocumentPanel } from '@/apps/drive/client/types'
export type { DocumentSaveState } from '@/apps/drive/files/features/document/header'

export const filePreviewSurface = defineAsyncComponent(
  () => import('@/apps/drive/files/features/preview/FilePreviewSurface.vue'),
)

export interface DriveDialogs {
  /** Opens the folder picker to move `node`. Resolves with the moved node, or `undefined` when cancelled. */
  move(node: string): Promise<DriveNodeSummary | undefined>
  /** Opens the folder picker to copy `node`. Resolves with the copy, or `undefined` when cancelled. */
  copy(node: string): Promise<DriveNodeSummary | undefined>
  /** Shows read-only details of `node`. Resolves when the dialog closes. */
  showDetails(node: string): Promise<void>
  /** Opens the share dialog for `node`. Resolves when it closes: `true` when a write in it went through. */
  share(node: string): Promise<boolean>
  /** Opens the file picker. Resolves with the picked file or document, or `undefined` when cancelled. */
  pickFile(options?: { title?: string; action?: string }): Promise<DriveNodeSummary | undefined>
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
    copy: (node) =>
      presentDialog<DriveNodeSummary>(
        context,
        () => import('@/apps/drive/files/features/CopyNodeDialog.vue'),
        { node },
        'copied',
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
    pickFile: (options = {}) =>
      presentDialog<DriveNodeSummary>(
        context,
        () => import('@/apps/drive/files/features/FilePicker.vue'),
        options,
        'choose',
      ),
  }
}
