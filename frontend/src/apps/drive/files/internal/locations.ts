import { api, useQuery } from '@/api'
import { bootRoots } from '@/apps/drive/client/roots'
import type { DriveBreadcrumb, DriveNode, DriveRoots } from '@/apps/drive/client/types'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { useWorkspace } from '@/platform/workspace'

/** The sidebar place a folder belongs to. */
export type FilesLocation = 'personal' | 'organization' | 'shared'

export const LOCATION_LABELS: Record<FilesLocation, string> = {
  personal: 'My files',
  organization: 'Organization files',
  shared: 'Shared with me',
}

/** The company name the Organization root shows under. Empty while no name is known. Reactive. */
export function organizationName(): string {
  return useWorkspace().workspaceName.value
}

/** The name of a sidebar place. The Organization root is "<company> files" once the company is known. */
export function locationLabel(location: FilesLocation): string {
  const name = location === 'organization' ? organizationName() : ''
  return name ? __('{0} files', [name]) : LOCATION_LABELS[location]
}

/** The path of one of the caller's own roots, which have their own pages. Any other node has none. */
export function rootPath(node: string, discovered: DriveRoots | null | undefined): string | null {
  if (node === discovered?.personal.node) return '/drive'
  if (node === discovered?.organization?.node) return '/drive/organization'
  return null
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
    return locationLabel('organization')
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
interface TrashLocationResult {
  path: string
  query: Record<string, string>
}

/**
 * The Trash tab that lists a node's root. Organization Trash has its own tab;
 * every other root's trash is the personal tab.
 */
export function trashLocation(
  node: Pick<DriveNode, 'root'>,
  discovered: DriveRoots | null | undefined,
): TrashLocationResult {
  const organization = discovered?.organization?.node
  return {
    path: '/drive/trash',
    query: organization && node.root === organization ? { root: 'organization' } : {},
  }
}

/**
 * `locationTitle` bound to the caller's roots, for templates. Call it in a
 * component's setup. The roots the page arrived with name a root until the
 * query answers, so "My files" never shows first as the root's stored title.
 */
export function useLocationTitle(): (node: Pick<DriveBreadcrumb, 'name' | 'title'>) => string {
  const session = useSession()
  // A guest has no roots to discover (spec §10.13).
  const discovered = useQuery(api.drive.roots.list, () =>
    session.status.value === 'authenticated' ? {} : false,
  )
  const booted = bootRoots()
  return (node) => locationTitle(node, discovered.data ?? booted)
}
