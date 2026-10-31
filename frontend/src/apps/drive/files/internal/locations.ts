import { api, useQuery } from '@/api'
import type { DriveBreadcrumb, DriveNode, DriveRoots } from '@/apps/drive/client/types'
import { useSession } from '@/platform/session'

/** The sidebar place a folder belongs to. */
export type FilesLocation = 'personal' | 'organization' | 'shared'

export const LOCATION_LABELS: Record<FilesLocation, string> = {
  personal: 'My files',
  organization: 'Organization files',
  shared: 'Shared with me',
}

/**
 * The name a node shows under. A root's stored title is node data (for an
 * older Personal Root it is the user's name), so the caller's own roots show
 * by their place instead, the way the sidebar names them.
 */
export function locationTitle(
  node: Pick<DriveBreadcrumb, 'name' | 'title'>,
  discovered: DriveRoots | null | undefined,
): string {
  if (discovered && node.name === discovered.personal.node) return LOCATION_LABELS.personal
  if (discovered?.organization && node.name === discovered.organization.node)
    return LOCATION_LABELS.organization
  return node.title
}

/**
 * Where a folder sits: in one of the caller's roots, or reached through a share.
 * Before the roots load, every folder reads as shared.
 */
export function locationOf(
  folder: Pick<DriveNode, 'root'>,
  discovered: DriveRoots | null | undefined,
): FilesLocation {
  if (discovered && folder.root === discovered.personal.node) return 'personal'
  if (discovered?.organization && folder.root === discovered.organization.node)
    return 'organization'
  return 'shared'
}

/**
 * The Trash tab that lists a node's root. Organization Trash has its own tab;
 * every other root's trash is the personal tab.
 */
export function trashLocation(
  node: Pick<DriveNode, 'root'>,
  discovered: DriveRoots | null | undefined,
): { path: string; query: Record<string, string> } {
  const organization = discovered?.organization?.node
  return {
    path: '/drive/trash',
    query: organization && node.root === organization ? { root: 'organization' } : {},
  }
}

/** `locationTitle` bound to the caller's roots, for templates. Call it in a component's setup. */
export function useLocationTitle(): (node: Pick<DriveBreadcrumb, 'name' | 'title'>) => string {
  const session = useSession()
  // A guest has no roots to discover (spec §10.13).
  const discovered = useQuery(api.drive.roots.list, () =>
    session.status.value === 'authenticated' ? {} : false,
  )
  return (node) => locationTitle(node, discovered.data)
}

/** Kinds of node that hold files in a listing. */
const FOLDER_KINDS = new Set(['folder', 'root'])

/**
 * The breadcrumbs end at the node's own folder, when the caller can read it.
 * A picture inside a Writer document or a Slides deck has no folder: the
 * document is its parent, and a document is never listed as a folder.
 */
export function folderOf(node: DriveNode): DriveBreadcrumb | null {
  const trail = node.breadcrumbs ?? []
  const parent = trail.at(-1)
  if (!parent || parent.name !== node.parent_node || !FOLDER_KINDS.has(parent.kind)) {
    return null
  }

  return trail.some((step) => step.kind === 'document') ? null : parent
}
