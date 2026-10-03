import { DRIVE_ROLES, type DriveNode, type DriveRoots } from '@/apps/drive/client/types'

export type PickerMode = 'move' | 'copy' | 'restore'

/** An item the picker places: which node it is, and the folder and root it is in now. */
export type PickedItem = Pick<DriveNode, 'name' | 'parent_node' | 'root'>

/** Whether the folder the picker shows can take the items. */
export type Destination =
  /** The caller's role on the folder has not loaded yet. */
  | { status: 'unknown' }
  | { status: 'allowed' }
  | { status: 'refused'; reason: string }

/**
 * The root the items are in, when they share one of the caller's roots, so the
 * picker opens where the items are. `null` for a mixed selection or items in
 * another user's root.
 */
export function itemsRoot(items: readonly PickedItem[], roots: DriveRoots): keyof DriveRoots | null {
  const root = items[0]?.root
  if (!root || items.some((item) => item.root !== root)) return null
  if (roots.personal.node === root) return 'personal'
  if (roots.organization?.node === root) return 'organization'
  return null
}

/**
 * The folder the picker opens in: the one the items are all in, or else
 * `current`, the folder the user is looking at. `null` opens the top of the root.
 */
export function startingFolder(items: readonly PickedItem[], current?: string): string | null {
  const parent = items[0]?.parent_node
  if (parent && items.every((item) => item.parent_node === parent)) return parent
  return current ?? null
}

/**
 * Whether the picker can open `folder`. A folder that is being moved cannot go
 * into itself or into a folder inside it, so the picker does not open it, and
 * the folders inside it stay out of reach.
 */
export function canOpenFolder(mode: PickerMode, items: readonly PickedItem[], folder: string): boolean {
  return mode !== 'move' || !items.some((item) => item.name === folder)
}

/**
 * Whether the items can go into `folder`. `role` is the caller's role on it,
 * `undefined` until it loads. Moving items into the folder they are already
 * in would change nothing, so the picker refuses it.
 */
export function destination(
  mode: PickerMode,
  items: readonly PickedItem[],
  folder: string,
  role: number | undefined,
): Destination {
  if (role === undefined) return { status: 'unknown' }
  if (role < DRIVE_ROLES.upload) return { status: 'refused', reason: 'You cannot add files to this folder.' }
  if (mode === 'move' && items.length && items.every((item) => item.parent_node === folder)) {
    const reason = items.length === 1 ? 'The item is already in this folder.' : 'The items are already in this folder.'
    return { status: 'refused', reason }
  }
  return { status: 'allowed' }
}
