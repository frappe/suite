import type { DriveBreadcrumb } from '@/apps/drive/client/types'

/** A folder and its ancestors, root first. The header shows it as breadcrumbs. */
export type FolderTrail = readonly DriveBreadcrumb[]

/** What the page knows about a folder before its details load. */
export interface KnownTrail {
  /** The trail from the folder's details. */
  loaded: FolderTrail | null
  /** The trail the header shows now. */
  shown: FolderTrail | null
  /** The trail of the row the user opened. */
  opened: FolderTrail | null
  /** The folder's title, from the link that led here or a cached copy of the folder. */
  title: string | null
}

/**
 * The trail to show for `target`. A folder's details load after the route
 * changes, so until they arrive the header keeps what the page already knows:
 *
 * - Going up, through a breadcrumb, the back button or browser history, the
 *   target is on the trail shown, and the trail stops at it.
 * - Opening a row, the page passes the row's trail as `opened`.
 * - Arriving from elsewhere, the header names the folder alone, when its title
 *   is known.
 *
 * Otherwise the trail is unknown, and the header waits for the details.
 */
export function folderTrail(target: string, known: KnownTrail): FolderTrail | null {
  const { loaded, shown, opened, title } = known
  if (loaded) return loaded
  const index = shown?.findIndex((crumb) => crumb.name === target) ?? -1
  if (shown && index >= 0) return shown.slice(0, index + 1)
  if (opened?.at(-1)?.name === target) return opened
  if (title) return [{ name: target, title }]
  return null
}
