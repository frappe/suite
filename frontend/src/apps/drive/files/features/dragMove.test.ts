import { describe, expect, it } from 'vitest'

import { DRIVE_ROLES, type DriveNode } from '@/apps/drive/client/types'

import {
  cancelDrag,
  checkDrop,
  draggedItems,
  hoverDrag,
  moveDrag,
  pressDrag,
  releaseDrag,
  type DragState,
  type DropTarget,
} from './dragMove'

function node(name: string, extra: Partial<DriveNode> = {}): DriveNode {
  return {
    name,
    title: name,
    kind: 'file',
    parent_node: 'here',
    root: 'root',
    state: 'Active',
    trash_root: null,
    size: 1,
    mime: null,
    url: null,
    content_doctype: null,
    content_docname: null,
    is_template: 0,
    owner: { id: 'me', full_name: 'Me', user_image: null },
    creation: null,
    modified: null,
    content_modified: null,
    access: { role: DRIVE_ROLES.edit },
    ...extra,
  }
}

function folder(
  name: string,
  role: number = DRIVE_ROLES.upload,
  ancestors = ['root', 'here'],
): DropTarget {
  return { kind: 'folder', node: name, title: name.toUpperCase(), role, ancestors }
}

const report = node('report')
const notes = node('notes')
const photos = node('photos', { kind: 'folder' })
const rows = [photos, report, notes]

/** Presses at the origin, then moves `distance` pixels to the right. */
function dragFrom(row: DriveNode, selection: string[], distance = 10): DragState {
  const pressed = pressDrag({ x: 0, y: 0 }, draggedItems(row, selection, rows))
  if (!pressed) throw new Error('the press did not start a drag')
  return moveDrag(pressed, { x: distance, y: 0 })
}

describe('what a drag carries', () => {
  it('drags the whole selection, in listing order, from one of its rows', () => {
    expect(draggedItems(notes, ['notes', 'photos'], rows)).toEqual({
      items: [photos, notes],
      fromSelection: true,
    })
  })

  it('drags only the pressed row when it is outside the selection', () => {
    expect(draggedItems(report, ['notes', 'photos'], rows)).toEqual({
      items: [report],
      fromSelection: false,
    })
  })

  it('does not start when an item cannot move', () => {
    const viewOnly = node('view-only', { access: { role: DRIVE_ROLES.read } })
    expect(pressDrag({ x: 0, y: 0 }, { items: [report, viewOnly], fromSelection: true })).toBeNull()
  })
})

describe('the drag gesture', () => {
  it('stays a click below the threshold', () => {
    const state = dragFrom(report, [], 3)
    expect(state.phase).toBe('pressed')
    expect(releaseDrag(state)).toEqual({ drop: null, swallowClick: false })
  })

  it('drops on a folder that takes the items, and swallows the click', () => {
    const over = hoverDrag(dragFrom(report, []), folder('archive'))
    expect(releaseDrag(over)).toEqual({
      drop: { dragged: { items: [report], fromSelection: false }, target: folder('archive') },
      swallowClick: true,
    })
  })

  it('drops nothing over a refusing target or over no target', () => {
    const refused = hoverDrag(dragFrom(report, []), folder('locked', DRIVE_ROLES.read))
    expect(releaseDrag(refused).drop).toBeNull()
    const nowhere = hoverDrag(refused, null)
    expect(releaseDrag(nowhere)).toEqual({ drop: null, swallowClick: true })
  })

  it('cancels with Escape, and still swallows the click that ends the press', () => {
    const cancelled = cancelDrag(hoverDrag(dragFrom(report, []), folder('archive')))
    expect(cancelled.phase).toBe('cancelled')
    expect(hoverDrag(cancelled, folder('archive'))).toBe(cancelled)
    expect(releaseDrag(cancelled)).toEqual({ drop: null, swallowClick: true })
  })
})

describe('which targets take the items', () => {
  it('takes a folder with UPLOAD and names it', () => {
    expect(checkDrop([report], folder('archive'))).toEqual({
      status: 'allowed',
      label: 'Move to ARCHIVE',
    })
  })

  it('refuses a folder the user cannot add to, and one whose role has not loaded', () => {
    expect(checkDrop([report], folder('locked', DRIVE_ROLES.comment))).toEqual({
      status: 'refused',
      reason: 'You cannot add files to this folder.',
    })
    const loading: DropTarget = {
      kind: 'folder',
      node: 'loading',
      title: 'Loading',
      role: undefined,
      ancestors: [],
    }
    expect(checkDrop([report], loading)).toEqual({
      status: 'refused',
      reason: 'Checking access…',
    })
  })

  it('refuses the folder the items are already in', () => {
    expect(checkDrop([report, notes], folder('here', DRIVE_ROLES.manage, ['root']))).toEqual({
      status: 'refused',
      reason: 'The items are already in this folder.',
    })
  })

  it('refuses a dragged folder itself and any folder inside it', () => {
    expect(checkDrop([photos, report], folder('photos'))).toEqual({
      status: 'refused',
      reason: 'A folder cannot go into itself.',
    })
    expect(checkDrop([photos], folder('holiday', DRIVE_ROLES.manage, ['root', 'photos']))).toEqual({
      status: 'refused',
      reason: 'A folder cannot go into a folder inside it.',
    })
  })

  it('takes Trash only when every item can be trashed', () => {
    expect(checkDrop([report], { kind: 'trash' })).toEqual({
      status: 'allowed',
      label: 'Move to Trash',
    })
    const shared = node('shared', { access: { role: DRIVE_ROLES.upload } })
    expect(checkDrop([report, shared], { kind: 'trash' }).status).toBe('refused')
  })
})
