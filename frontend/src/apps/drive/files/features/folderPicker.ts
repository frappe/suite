import type { NodeMovePreviewOutput } from '@/apps/drive/client/generated'
import { groupName, principalKind } from '@/apps/drive/client/grants'
import { DRIVE_ROLES, type DriveNode, type DriveRoots } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'
import { isTweakOn } from '@/platform/tweaks'

import { bootedWorkspace, organizationLabel } from './share/shareModel'

export type PickerMode = 'move' | 'copy' | 'restore'

/** An item the picker places: which node it is, and the folder and root it is in now. */
export type PickedItem = Pick<DriveNode, 'name' | 'parent_node' | 'root'>

/** Whether the folder the picker shows can take the items. */
export type Destination =
  /** The caller's role on the folder has not loaded yet. */
  { status: 'unknown' } | { status: 'allowed' } | { status: 'refused'; reason: string }

/**
 * The root the items are in, when they share one of the caller's roots, so the
 * picker opens where the items are. `null` for a mixed selection or items in
 * another user's root.
 */
export function itemsRoot(
  items: readonly PickedItem[],
  roots: DriveRoots,
): keyof DriveRoots | null {
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
export function canOpenFolder(
  mode: PickerMode,
  items: readonly PickedItem[],
  folder: string,
): boolean {
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
  if (role < DRIVE_ROLES.upload)
    return { status: 'refused', reason: 'You cannot add files to this folder.' }
  if (mode === 'move' && items.length && items.every((item) => item.parent_node === folder)) {
    const reason =
      items.length === 1
        ? 'The item is already in this folder.'
        : 'The items are already in this folder.'
    return { status: 'refused', reason }
  }
  return { status: 'allowed' }
}

/** Someone a move gives more access, as the move confirmation lists them. */
export interface MoveAccessGain {
  principal: string
  label: string
  role: number
  person?: NodeMovePreviewOutput['gains'][number]['person']
}

/** What a move changes, for the move confirmation (unified frontend §5.7). */
export interface MoveAccessChange {
  /** Strongest access first, each principal once, with the most it gains across the items. */
  gains: MoveAccessGain[]
  /** The mover's lowest role after the move, when it drops. `0` is no access. */
  ownRoleAfter: number | null
}

/** From each item's move preview. `null` when the move goes ahead without asking. */
export function moveAccessChange(
  previews: readonly NodeMovePreviewOutput[],
): MoveAccessChange | null {
  const gains = new Map<string, MoveAccessGain>()
  for (const { principal, role, person } of previews.flatMap((preview) => preview.gains)) {
    const known = gains.get(principal)
    if (known && known.role >= role) continue
    gains.set(principal, {
      principal,
      role,
      person,
      label: person?.full_name ?? gainLabel(principal),
    })
  }
  const dropped = previews.filter((preview) => preview.role_after < preview.role_now)
  const ownRoleAfter = dropped.length
    ? Math.min(...dropped.map((preview) => preview.role_after))
    : null
  if (!gains.size && ownRoleAfter === null) return null
  return { gains: [...gains.values()].sort((a, b) => b.role - a.role), ownRoleAfter }
}

function gainLabel(principal: string): string {
  switch (principalKind(principal)) {
    case 'group':
      return __('People in {0}', [groupName(principal)])
    case 'general':
      return __(organizationLabel(bootedWorkspace()))
    case 'public':
      return isTweakOn('t4-access-words') ? __('Public on the web') : __('Everyone on the web')
    case 'link':
      return __('Anyone with a share link')
    case 'user':
      return principal
  }
}
