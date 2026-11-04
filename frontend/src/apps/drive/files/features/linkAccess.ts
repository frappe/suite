import { DRIVE_ROLES, hasRole, type DriveNode } from '@/apps/drive/client/types'

/**
 * What a node reached through a share link offers (spec §10.7, §10.13,
 * §10.14).
 *
 * `access.via_link` names the link when it decided the caller's role: the
 * caller's own grants give less. Starred, Recent and Shared with me send no
 * link codes, so they could never show such a node. Star is hidden and no
 * visit is recorded. A guest has no views at all.
 *
 * Known gap: the access payload (`_describe_rows` in
 * `suite/drive/_core/access.py`) names only the winning role and source, so a
 * member with a lower grant of their own who opens a higher link also counts
 * as link-only here. The fix waits on the server sending the caller's own role.
 */

type Node = Pick<DriveNode, 'access'> | null | undefined

export interface LinkAccess {
  /** Star and Unstar show. */
  star: boolean
  /** Opening the node records a visit for Recent. */
  visit: boolean
  /** New offers the document kinds and From template. */
  documentKinds: boolean
}

export function isLinkOnly(node: Node): boolean {
  return !!node?.access?.via_link
}

export function linkAccess(node: Node, signedIn: boolean): LinkAccess {
  const ownAccess = signedIn && !isLinkOnly(node)
  return {
    star: ownAccess,
    visit: ownAccess,
    // Below EDIT through a link there is no creator grant, so the maker could not edit a new document.
    documentKinds: !isLinkOnly(node) || hasRole(node, DRIVE_ROLES.edit),
  }
}
