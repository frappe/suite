import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import { DRIVE_ROLES, type DriveNode } from '@/apps/drive/client/types'

import {
  canOpenFolder,
  destination,
  itemsRoot,
  type PickedItem,
  type PickerMode,
} from './folderPicker'
import FolderPicker from './FolderPicker.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Breadcrumbs')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Skeleton')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/TabButtons')),
}))

// My files holds Projects and Archive. Projects holds Launch, where the report is, and Launch holds Assets.
const net = vi.hoisted(() => {
  const folder = (
    name: string,
    title: string,
    parent: string | null,
    breadcrumbs: Array<{ name: string; title: string; kind: string }>,
  ) => ({
    name,
    title,
    kind: 'folder',
    parent_node: parent,
    root: 'mine',
    state: 'Active',
    trash_root: null,
    size: 0,
    mime: null,
    url: null,
    content_doctype: null,
    content_docname: null,
    is_template: 0,
    owner: { id: 'me@example.com', full_name: 'Me', user_image: null },
    creation: null,
    modified: null,
    content_modified: null,
    access: { role: 50 },
    breadcrumbs,
  })
  const top = { name: 'mine', title: 'Aanya', kind: 'folder' }
  const nodes = new Map([
    ['mine', folder('mine', 'Aanya', null, [])],
    ['projects', folder('projects', 'Projects', 'mine', [top])],
    ['archive', folder('archive', 'Archive', 'mine', [top])],
    [
      'launch',
      folder('launch', 'Launch', 'projects', [
        top,
        { name: 'projects', title: 'Projects', kind: 'folder' },
      ]),
    ],
    [
      'assets',
      folder('assets', 'Assets', 'launch', [
        top,
        { name: 'projects', title: 'Projects', kind: 'folder' },
        { name: 'launch', title: 'Launch', kind: 'folder' },
      ]),
    ],
  ])
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(status === 200 ? { data } : data), { status })
  globalThis.fetch = async (url: RequestInfo | URL) => {
    const path = new URL(String(url), 'http://drive.test').pathname.replace('/api/suite/drive/', '')
    if (path === 'roots')
      return json({ personal: { node: 'mine', title: 'Aanya' }, organization: null })
    const [, name, children] = path.match(/^nodes\/([^/]+)(\/children)?$/) ?? []
    const node = name ? nodes.get(name) : undefined
    if (node && !children) return json(node)
    if (node)
      return json({
        rows: [...nodes.values()].filter((row) => row.parent_node === name),
        next_cursor: null,
      })
    return json({ errors: [{ type: 'NotFound', message: path }] }, 404)
  }
  return { nodes }
})

const report = { name: 'report', parent_node: 'root', root: 'root' }
const archive = { name: 'archive', parent_node: 'root', root: 'root' }
const notes = { name: 'notes', parent_node: 'talk', root: 'root' }

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
      status: 'refused',
      reason: 'The item is already in this folder.',
    })
    expect(destination('move', [report, archive], 'root', DRIVE_ROLES.edit)).toEqual({
      status: 'refused',
      reason: 'The items are already in this folder.',
    })
  })

  it('moves a mixed selection into the folder one of them is in', () => {
    expect(destination('move', [report, notes], 'root', DRIVE_ROLES.edit)).toEqual({
      status: 'allowed',
    })
  })

  it('copies into the folder the item is in', () => {
    expect(destination('copy', [report], 'root', DRIVE_ROLES.edit)).toEqual({ status: 'allowed' })
  })

  it('needs upload access on the folder', () => {
    expect(destination('move', [notes], 'root', DRIVE_ROLES.comment)).toEqual({
      status: 'refused',
      reason: 'You cannot add files to this folder.',
    })
    expect(destination('move', [notes], 'root', DRIVE_ROLES.upload)).toEqual({ status: 'allowed' })
  })

  it('waits for the folder access before deciding', () => {
    expect(destination('move', [report], 'root', undefined)).toEqual({ status: 'unknown' })
  })
})

describe('folder picker starting root', () => {
  const roots = {
    personal: { node: 'mine', title: 'My files' },
    organization: { node: 'org', title: 'Acme' },
  }
  const plan = { name: 'plan', parent_node: 'team', root: 'org' }
  const budget = { name: 'budget', parent_node: 'org', root: 'org' }
  const draft = { name: 'draft', parent_node: 'mine', root: 'mine' }

  it('opens on the root the items are in, wherever they were picked from', () => {
    expect(itemsRoot([plan, budget], roots)).toBe('organization')
    expect(itemsRoot([draft], roots)).toBe('personal')
  })

  it("has no starting root for a mixed selection or items in another user's root", () => {
    expect(itemsRoot([plan, draft], roots)).toBeNull()
    expect(itemsRoot([{ name: 'shared', parent_node: 'theirs', root: 'theirs' }], roots)).toBeNull()
    expect(itemsRoot([plan], { ...roots, organization: null })).toBeNull()
    expect(itemsRoot([], roots)).toBeNull()
  })
})

describe('Folder picker', () => {
  let cleanup: (() => void) | undefined
  afterEach(() => cleanup?.())

  function openPicker(props: { mode: PickerMode; items: PickedItem[]; folder?: string }) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp({ setup: () => () => h(FolderPicker, { open: true, ...props }) })
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
    }
  }

  /** The folder the picker shows, by the label of its folder list. */
  function shownFolder(): string | undefined {
    return document
      .querySelector('ul[aria-label^="Folders in "]')
      ?.getAttribute('aria-label')
      ?.replace('Folders in ', '')
  }

  const report: PickedItem = { name: 'report', parent_node: 'launch', root: 'mine' }
  const notes: PickedItem = { name: 'notes', parent_node: 'archive', root: 'mine' }
  const projects = net.nodes.get('projects') as DriveNode

  it('opens in the folder the item is in', async () => {
    openPicker({ mode: 'move', items: [report] })
    await vi.waitFor(() => expect(shownFolder()).toBe('Launch'))
    expect(document.body.textContent).toContain('The item is already in this folder.')
  })

  it('opens a selection from different folders in the folder the user is looking at', async () => {
    openPicker({ mode: 'move', items: [report, notes], folder: 'projects' })
    await vi.waitFor(() => expect(shownFolder()).toBe('Projects'))
  })

  it('opens at the top of My files when nothing says where to start', async () => {
    openPicker({ mode: 'move', items: [report, notes] })
    await vi.waitFor(() => expect(shownFolder()).toBe('My files'))
  })

  it('does not open inside a folder that is being moved', async () => {
    openPicker({ mode: 'move', items: [projects, notes], folder: 'launch' })
    await vi.waitFor(() => expect(shownFolder()).toBe('My files'))
  })
})
