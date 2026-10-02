import { describe, expect, it } from 'vitest'

import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { allAllow, nodeActions, type ActionNode, type NodeActions } from './nodeActions'

/** A node named "n". A trashed one is its own trash root unless `trashRoot` names another node. */
function node(kind: string, state: string, role: number, viaLink: string | null = null, trashRoot?: string): ActionNode {
  const trash_root = state === 'Active' ? null : (trashRoot ?? 'n')
  return { name: 'n', kind, state, trash_root, access: { role, via_link: viaLink } }
}

/** The names of the actions a node offers, for readable expectations. */
function offered(actions: NodeActions): string[] {
  return Object.entries(actions).filter(([, on]) => on).map(([name]) => name).sort()
}

describe('nodeActions', () => {
  it('offers a manager every action on an Active file, and no Trash actions', () => {
    expect(offered(nodeActions(node('file', 'Active', DRIVE_ROLES.manage), true))).toEqual(
      ['copy', 'copyLink', 'download', 'move', 'openInNewTab', 'rename', 'share', 'star', 'trash'],
    )
  })

  it('offers a reader of an Active file no change to it', () => {
    expect(offered(nodeActions(node('file', 'Active', DRIVE_ROLES.read), true))).toEqual(
      ['copy', 'copyLink', 'download', 'openInNewTab', 'star'],
    )
  })

  it('offers a trashed file only Restore, Delete forever and Download', () => {
    expect(offered(nodeActions(node('file', 'Trashed', DRIVE_ROLES.manage), true))).toEqual(
      ['deleteForever', 'download', 'restore'],
    )
  })

  it('offers a trashed folder no Download, because its archive needs an Active folder', () => {
    expect(offered(nodeActions(node('folder', 'Trashed', DRIVE_ROLES.manage), true))).toEqual(
      ['deleteForever', 'restore'],
    )
  })

  it('needs EDIT to restore and MANAGE to delete forever', () => {
    expect(offered(nodeActions(node('document', 'Trashed', DRIVE_ROLES.edit), true))).toEqual(['restore'])
    expect(offered(nodeActions(node('document', 'Trashed', DRIVE_ROLES.read), true))).toEqual([])
  })

  it('offers a node inside a trashed folder no Restore or Delete forever, because it comes back with its trash root', () => {
    expect(offered(nodeActions(node('file', 'Trashed', DRIVE_ROLES.manage, null, 'outer'), true))).toEqual(['download'])
    expect(offered(nodeActions(node('folder', 'Trashed', DRIVE_ROLES.manage, null, 'outer'), true))).toEqual([])
  })

  it('enables a bulk action only when every selected node allows it', () => {
    const own = node('file', 'Trashed', DRIVE_ROLES.manage)
    const shared = node('file', 'Trashed', DRIVE_ROLES.edit)
    expect(allAllow([own, shared], 'restore', true)).toBe(true)
    expect(allAllow([own, shared], 'deleteForever', true)).toBe(false)
    expect(allAllow([own, node('file', 'Active', DRIVE_ROLES.manage)], 'trash', true)).toBe(false)
    expect(allAllow([], 'trash', true)).toBe(false)
  })
})
