import { defineAsyncComponent, defineComponent, h } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import { createDocument } from '@/apps/drive/client/nodes'
import { openDriveDocumentSession } from '@/apps/drive/client/session'
import type { DriveNode } from '@/apps/drive/client/types'
import { recents } from '@/apps/drive/client/views'
import { slugify } from '@/apps/drive/files/internal/slugify'
import type { AreaDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

export type {
  CredentialGroup,
  CredentialGrouper,
  DocumentSession,
  MediaHandle,
  MediaStatus,
  SessionState,
  UnavailableShare,
} from '@/apps/drive/client/session'
export { CredentialOverflowError } from '@/apps/drive/client/session'

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
  label: () => __('Files'),
  icon: FilesIcon,
  to: '/files',
  loadRoutes: () => import('@/apps/drive/files/pages/routes'),
  loadPanel: async () => (await import('@/apps/drive/files/pages/FilesPanel.vue')).default,
}

export function driveRecents(limit = 12) {
  return recents(limit)
}

export function createDriveDocument() {
  return createDocument()
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
  const base = nodeKind === 'folder' ? `/files/f/${encodeURIComponent(id)}` : `/d/${encodeURIComponent(id)}`
  return { path: `${base}${slug ? `/${slug}` : ''}` }
}

export function openDocumentSession(nodeId: string) {
  return openDriveDocumentSession(nodeId).catch(async (error) => {
    if (!(error instanceof Error) || !error.message.includes('is not a content document')) throw error
    const { openFilePreviewSession } = await import('@/apps/drive/files/features/preview/session')
    return openFilePreviewSession(nodeId)
  })
}

export const filePreviewSurface = defineAsyncComponent(
  () => import('@/apps/drive/files/features/preview/FilePreviewSurface.vue'),
)

// Migration debt. Keep these lazy legacy dialog exports until Writer and Slides migrate.
export const ShareDialog = defineAsyncComponent(
  () => import('@/apps/drive/legacy/ui/drive/components/ShareDialog.vue'),
)
export const MoveDialog = defineAsyncComponent(
  () => import('@/apps/drive/legacy/ui/drive/components/MoveDialog.vue'),
)
export const InfoDialog = defineAsyncComponent(
  () => import('@/apps/drive/legacy/ui/drive/components/InfoDialog.vue'),
)
