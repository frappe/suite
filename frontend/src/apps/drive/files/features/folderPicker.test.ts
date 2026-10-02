import { describe, expect, it } from 'vitest'

import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { canOpenFolder, destination } from './folderPicker'

const report = { name: 'report', parent: 'root' }
const archive = { name: 'archive', parent: 'root' }
const notes = { name: 'notes', parent: 'talk' }

describe('folder picker destinations', () => {
  it('does not open a folder that is being moved, so nothing moves into itself or its subfolders', () => {
    expect(canOpenFolder('move', [report, archive], 'archive')).toBe(false)
    expect(canOpenFolder('move', [report, archive], 'talk')).toBe(true)
  })

  it('opens every folder when copying or restoring', () => {
    expect(canOpenFolder('copy', [archive], 'archive')).toBe(true)
    expect(canOpenFolder('restore', [], 'archive')).toBe(true)
  })

  it('refuses to move items into the folder they are already in', () => {
    expect(destination('move', [report], 'root', DRIVE_ROLES.edit)).toEqual({
      status: 'refused', reason: 'The item is already in this folder.',
    })
    expect(destination('move', [report, archive], 'root', DRIVE_ROLES.edit)).toEqual({
      status: 'refused', reason: 'The items are already in this folder.',
    })
  })

  it('moves a mixed selection into the folder one of them is in', () => {
    expect(destination('move', [report, notes], 'root', DRIVE_ROLES.edit)).toEqual({ status: 'allowed' })
  })

  it('copies into the folder the item is in', () => {
    expect(destination('copy', [report], 'root', DRIVE_ROLES.edit)).toEqual({ status: 'allowed' })
  })

  it('needs upload access on the folder', () => {
    expect(destination('move', [notes], 'root', DRIVE_ROLES.comment)).toEqual({
      status: 'refused', reason: 'You cannot add files to this folder.',
    })
    expect(destination('move', [notes], 'root', DRIVE_ROLES.upload)).toEqual({ status: 'allowed' })
  })

  it('waits for the folder access before deciding', () => {
    expect(destination('move', [report], 'root', undefined)).toEqual({ status: 'unknown' })
  })
})
