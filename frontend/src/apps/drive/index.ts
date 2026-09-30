import { defineAsyncComponent, defineComponent, getCurrentInstance, h, ref } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import { driveLinks } from '@/apps/drive/client/links'
import { createDocument, recordVisit } from '@/apps/drive/client/nodes'
import { roots } from '@/apps/drive/client/roots'
import { openDriveDocumentSession } from '@/apps/drive/client/session'
import type { DriveNode } from '@/apps/drive/client/types'
import { recents } from '@/apps/drive/client/views'
import { presentDialog, rememberDialogContext } from '@/apps/drive/files/features/dialogHost'
import { slugify } from '@/apps/drive/files/internal/slugify'
import type { AreaDefinition } from '@/platform/contracts'
import { useMutation, useQuery } from '@/platform/server-state'
import { translate as __ } from '@/platform/translation'

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

/** The name a guest typed for comments. `null` while signed in. */
export function driveGuestName(): string | null {
  return driveLinks.guestName()
}

export function setDriveGuestName(name: string): void {
  driveLinks.setGuestName(name)
}

export type DriveNodeSummary = Pick<
  DriveNode,
  'name' | 'title' | 'kind' | 'mime' | 'content_doctype' | 'content_docname' | 'state' | 'access' | 'preview' | 'opened_at'
>

const FilesIcon = defineComponent({
  name: 'FilesAreaIcon',
  setup: () => () => h('span', { class: 'lucide-folder size-4', 'aria-hidden': 'true' }),
})

export const filesArea: AreaDefinition = {
  id: 'files',
  label: () => __('Drive'),
  icon: FilesIcon,
  to: '/drive',
  loadRoutes: () => import('@/apps/drive/files/pages/routes'),
}

/** Drive's Settings group. Loads when Settings opens. */
export const loadDriveSettings = () =>
  import('@/apps/drive/files/features/settings/settingsGroup').then((module) => module.driveSettings())

export function driveRecents(limit = 12) {
  return recents(limit)
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
      return create.run({ parent, content_doctype })
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
): RouteLocationRaw {
  const id = typeof node === 'string' ? node : node.name
  const label = typeof node === 'string' ? (title ?? '') : node.title
  const nodeKind = typeof node === 'string' ? kind : node.kind
  const slug = slugify(label)
  const base = nodeKind === 'folder' ? `/drive/f/${encodeURIComponent(id)}` : `/d/${encodeURIComponent(id)}`
  return { path: `${base}${slug ? `/${slug}` : ''}` }
}

export function openDocumentSession(nodeId: string) {
  // `session.share()` opens its dialog in the app that opened the session.
  rememberDialogContext(getCurrentInstance()?.appContext)
  return openDriveDocumentSession(nodeId).catch(async (error) => {
    if (!(error instanceof Error) || !error.message.includes('is not a content document')) throw error
    const { openFilePreviewSession } = await import('@/apps/drive/files/features/preview/session')
    return openFilePreviewSession(nodeId)
  })
}

export { isDriveLocked, isDriveNodeLocked } from '@/apps/drive/client/unlock'

/** The password screen a node route shows in place on `401 DriveLocked` (spec §10.2). Emits `unlocked`. */
export const DriveUnlockScreen = defineAsyncComponent(() => import('@/apps/drive/files/features/UnlockScreen.vue'))

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
      presentDialog<DriveNodeSummary>(context, () => import('@/apps/drive/files/features/MoveNodeDialog.vue'), { node }, 'moved'),
    showDetails: async (node) => {
      await presentDialog(context, () => import('@/apps/drive/files/features/NodeInfoDialog.vue'), { node })
    },
    share: (node) => import('@/apps/drive/files/features/share/present').then((share) => share.presentShareDialog(node, context)),
  }
}
