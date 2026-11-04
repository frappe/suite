import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useDoc: vi.fn(),
  emitLoaded: (_doc: Record<string, unknown>) => {},
}))

vi.mock('frappe-ui', () => ({
  useDoc: mocks.useDoc,
  useFileUpload: () => ({}),
  toast: vi.fn(),
  createResource: () => ({ submit: vi.fn() }),
}))
vi.mock('@/boot/session', () => ({ useSessionStore: () => ({ isLoggedIn: false }) }))
vi.mock('@/apps/writer/resources/', () => ({ getDocuments: { updateRow: vi.fn() } }))
vi.mock('@/apps/writer/router', () => ({ default: { replace: mocks.replace } }))
// The real rule, so these tests fail if it stops telling the two kinds apart.
vi.mock('@/apps/drive/sdk', async () => {
  const { isUploadedDocument } = await import('@/apps/drive/utils/files')
  return { prettyData: (doc: unknown) => doc, isUploadedDocument }
})
vi.mock('@/apps/drive/router', () => ({ default: {} }))
vi.mock('@/apps/drive/ui/drive/js/utils', () => ({ getFileLink: vi.fn() }))
vi.mock('@/apps/drive/resources/files', () => ({}))
vi.mock('@/apps/drive/data/breadcrumbs', () => ({}))
vi.mock('@/apps/drive/data/currentFolder', () => ({ currentFolder: { value: null } }))
vi.mock('@/apps/drive/emitter', () => ({ default: { emit: vi.fn(), on: vi.fn() } }))
vi.mock('@/apps/drive/utils/toasts.js', () => ({ toast: vi.fn() }))
vi.mock('idb-keyval', () => ({ set: vi.fn() }))

import useDocument from './useDocument'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useDoc.mockImplementation(({ doctype }: { doctype: string }) => ({
    doctype,
    onSuccess: (callback: (doc: Record<string, unknown>) => void) => {
      mocks.emitLoaded = callback
    },
  }))
})

describe('useDocument', () => {
  it('sends an old Writer link to an uploaded Word file to the Drive file page', () => {
    useDocument('file-1')
    mocks.emitLoaded({ name: 'file-1', file_type: 'Document', content_doctype: null })

    expect(mocks.replace).toHaveBeenCalledWith({
      name: 'drive-File',
      params: { entityName: 'file-1' },
    })
    expect(mocks.useDoc).toHaveBeenCalledTimes(1)
  })

  it('loads the Writer Document for a real Writer document', () => {
    const { document } = useDocument('file-2')
    mocks.emitLoaded({
      name: 'file-2',
      file_type: 'Document',
      content_doctype: 'Writer Document',
      content_docname: 'doc-2',
    })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(document.value).toMatchObject({ doctype: 'Writer Document' })
  })
})
