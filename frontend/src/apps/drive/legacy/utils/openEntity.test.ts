import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  getFileLink: vi.fn(() => 'http://localhost/drive/f/abc'),
  open: vi.fn(),
  confirm: vi.fn(() => true),
}))

vi.mock('@/apps/drive/router', () => ({ default: { push: mocks.routerPush } }))
vi.mock('@/apps/drive/ui/drive/js/utils', () => ({ getFileLink: mocks.getFileLink }))
vi.mock('@/apps/drive/resources/files', () => ({
  getRecents: { data: [], setData: vi.fn() },
  mutate: vi.fn(),
  createDocument: {},
  createSheet: {},
  getDocuments: {},
}))
vi.mock('@/apps/drive/data/breadcrumbs', () => ({ isHomeContext: () => true }))
vi.mock('@/apps/drive/data/currentFolder', () => ({ currentFolder: { value: null } }))
vi.mock('@/apps/drive/emitter', () => ({ default: { emit: vi.fn(), on: vi.fn() } }))
vi.mock('@/apps/drive/utils/toasts.js', () => ({ toast: vi.fn() }))
vi.mock('idb-keyval', () => ({ set: vi.fn() }))
vi.mock('frappe-ui', () => ({ useFileUpload: () => ({}), toast: vi.fn() }))

import { openEntity, folderRoute } from './files'

const location = { origin: 'http://localhost' }

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', { configurable: true, value: location })
  window.open = mocks.open
  window.confirm = mocks.confirm
})

const entity = (overrides: Record<string, unknown>) => ({
  name: 'file-1',
  file_name: 'Thing',
  file_url: '/private/files/thing',
  ...overrides,
})

describe('openEntity', () => {
  it('routes a folder in-app', () => {
    openEntity(entity({ name: 'folder-1', is_folder: true }))
    expect(mocks.routerPush).toHaveBeenCalledWith({
      name: 'drive-Folder',
      params: { entityName: 'folder-1' },
    })
  })

  it('opens a native presentation by its content docname', () => {
    openEntity(
      entity({
        file_type: 'Presentation',
        mime_type: 'frappe/slides',
        content_doctype: 'Presentation',
        content_docname: 'pres-9',
      })
    )
    expect(mocks.routerPush).toHaveBeenCalledWith({
      name: 'slides-editor',
      params: { presentationId: 'pres-9' },
    })
  })

  it('previews an uploaded .pptx instead of opening Slides', () => {
    openEntity(
      entity({
        file_type: 'Presentation',
        mime_type:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })
    )
    expect(mocks.routerPush).toHaveBeenCalledWith({
      name: 'drive-File',
      params: { entityName: 'file-1' },
    })
  })

  it('opens a native sheet by its content docname', () => {
    openEntity(
      entity({
        file_type: 'Spreadsheet',
        content_doctype: 'Sheet',
        content_docname: 'sheet-4',
      })
    )
    expect(mocks.routerPush).toHaveBeenCalledWith({
      name: 'sheets-editor',
      params: { id: 'sheet-4' },
    })
  })

  it('previews an uploaded spreadsheet instead of opening Sheets', () => {
    openEntity(entity({ file_type: 'Spreadsheet', mime_type: 'text/csv' }))
    expect(mocks.routerPush).toHaveBeenCalledWith({
      name: 'drive-File',
      params: { entityName: 'file-1' },
    })
  })

  it('opens a writer document', () => {
    openEntity(
      entity({
        file_type: 'Document',
        content_doctype: 'Writer Document',
        content_docname: 'doc-2',
      })
    )
    expect(mocks.routerPush).toHaveBeenCalledWith({
      name: 'writer-document',
      params: { id: 'file-1' },
    })
  })

  it('confirms before following a link entity', () => {
    openEntity(entity({ file_type: 'Link', file_url: 'https://frappe.io/x' }))
    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.open).toHaveBeenCalledWith('https://frappe.io/x', '_blank')
  })

  it('does not follow a link when the confirmation is declined', () => {
    mocks.confirm.mockReturnValueOnce(false)
    openEntity(entity({ file_type: 'Link', file_url: 'https://frappe.io/x' }))
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('drills into a virtual attachments node', () => {
    openEntity(
      entity({
        kind: 'virtual',
        attached_to_doctype: 'ToDo',
        attached_to_name: 'todo-1',
      })
    )
    expect(mocks.routerPush).toHaveBeenCalledWith({
      name: 'drive-Attachments',
      params: { doctype: 'ToDo', docname: 'todo-1' },
    })
  })

  it('drills into a virtual doctype node that has no document yet', () => {
    openEntity(entity({ kind: 'virtual', attached_to_doctype: 'ToDo' }))
    expect(mocks.routerPush).toHaveBeenCalledWith({
      name: 'drive-Attachments',
      params: { doctype: 'ToDo' },
    })
  })

  it('opens in a new tab via the shared link builder', () => {
    openEntity(entity({ file_type: 'PDF' }), true)
    expect(mocks.open).toHaveBeenCalledWith('http://localhost/drive/f/abc', '_blank')
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })
})

describe('folderRoute', () => {
  it('routes a real folder to the Drive tree', () => {
    expect(folderRoute(entity({ name: 'folder-1', is_folder: true }))).toEqual({
      name: 'drive-Folder',
      params: { entityName: 'folder-1' },
    })
  })

  // A virtual node's `name` is a doctype or a docname, so routing it like a
  // folder lands on a File that doesn't exist.
  it('routes a virtual doctype node to its attachments bucket', () => {
    expect(
      folderRoute(
        entity({ name: 'ToDo', is_folder: true, kind: 'virtual', attached_to_doctype: 'ToDo' })
      )
    ).toEqual({ name: 'drive-Attachments', params: { doctype: 'ToDo' } })
  })

  it('routes a virtual document node to that document', () => {
    expect(
      folderRoute(
        entity({
          name: 'todo-1',
          is_folder: true,
          kind: 'virtual',
          attached_to_doctype: 'ToDo',
          attached_to_name: 'todo-1',
        })
      )
    ).toEqual({
      name: 'drive-Attachments',
      params: { doctype: 'ToDo', docname: 'todo-1' },
    })
  })
})
