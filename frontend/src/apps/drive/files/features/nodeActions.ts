import { DRIVE_ROLES, hasRole, type DriveNode } from '@/apps/drive/client/types'

import { linkAccess } from './linkAccess'

/**
 * The actions one node offers in the listing's menus and selection bar
 * (unified frontend spec §5.6, §5.8). Open and Select are always offered and
 * are not listed here.
 *
 * A trashed node is read-only (Drive spec §4.2, §8.8). It offers Download when
 * it is a file. Only a trash root, the node the user trashed, offers Restore
 * and Delete forever. A node inside a trashed folder is Trashed too, because
 * trashing stamps the whole subtree, and it comes back only with its trash
 * root (Drive spec §5.6, §8.8).
 *
 * The server checks every action again. Restore needs EDIT when the caller
 * trashed the node and MANAGE otherwise; the client does not know who trashed
 * it, so EDIT shows Restore and the server refuses the rest.
 */
export interface NodeActions {
  openInNewTab: boolean
  share: boolean
  copyLink: boolean
  download: boolean
  rename: boolean
  move: boolean
  copy: boolean
  star: boolean
  trash: boolean
  restore: boolean
  deleteForever: boolean
}

export type ActionNode = Pick<DriveNode, 'name' | 'kind' | 'state' | 'trash_root' | 'access'>

/** Whether the node can be renamed: an Active node, with EDIT. A document's header uses the same rule as the listing. */
export function canRename(node: Pick<DriveNode, 'access'> & { state: string }): boolean {
  return node.state === 'Active' && hasRole(node, DRIVE_ROLES.edit)
}

export function nodeActions(node: ActionNode, signedIn: boolean): NodeActions {
  const edit = hasRole(node, DRIVE_ROLES.edit)
  const manage = hasRole(node, DRIVE_ROLES.manage)
  if (node.state !== 'Active') {
    const trashRoot = node.trash_root === node.name
    return {
      openInNewTab: false,
      share: false,
      copyLink: false,
      // A folder archive needs an Active folder. A file's bytes need READ only.
      download: node.kind === 'file',
      rename: false,
      move: false,
      copy: false,
      star: false,
      trash: false,
      restore: trashRoot && edit,
      deleteForever: trashRoot && manage,
    }
  }
  return {
    openInNewTab: true,
    // Share needs MANAGE (spec §7.2). A link gives at most EDIT, so guests and link-only readers never see it.
    share: manage,
    copyLink: true,
    download: node.kind !== 'link',
    rename: canRename(node),
    move: edit,
    copy: true,
    star: linkAccess(node, signedIn).star,
    trash: edit,
    restore: false,
    deleteForever: false,
  }
}

/** Whether every node allows the action, for a selection's bulk bar. An empty selection allows none. */
export function allAllow(nodes: readonly ActionNode[], action: keyof NodeActions, signedIn: boolean): boolean {
  return nodes.length > 0 && nodes.every((node) => nodeActions(node, signedIn)[action])
}
