import type { DriveBreadcrumb, DriveNode, DriveRoots } from '@/apps/drive/client/types'
import { roots } from '@/apps/drive/client/roots'
import { useQuery } from '@/platform/server-state'
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
export function locationTitle(node: Pick<DriveBreadcrumb, 'name' | 'title'>, discovered: DriveRoots | null | undefined): string {
  if (discovered && node.name === discovered.personal.node) return LOCATION_LABELS.personal
  if (discovered?.organization && node.name === discovered.organization.node) return LOCATION_LABELS.organization
  return node.title
}

/**
 * Where a folder sits: in one of the caller's roots, or reached through a share.
 * Before the roots load, every folder reads as shared.
 */
export function locationOf(folder: Pick<DriveNode, 'root'>, discovered: DriveRoots | null | undefined): FilesLocation {
  if (discovered && folder.root === discovered.personal.node) return 'personal'
  if (discovered?.organization && folder.root === discovered.organization.node) return 'organization'
  return 'shared'
}

/** `locationTitle` bound to the caller's roots, for templates. Call it in a component's setup. */
export function useLocationTitle(): (node: Pick<DriveBreadcrumb, 'name' | 'title'>) => string {
  const session = useSession()
  // A guest has no roots to discover (spec §10.13).
  const discovered = useQuery(() => session.status.value === 'authenticated' ? roots() : false)
  return (node) => locationTitle(node, discovered.data)
}
