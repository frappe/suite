import { beforeEach, describe, expect, it, vi } from 'vitest'

const idb = vi.hoisted(() => ({ set: vi.fn() }))

vi.mock('@/apps/drive/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/apps/drive/ui/drive/js/utils', () => ({ getFileLink: vi.fn() }))
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
vi.mock('idb-keyval', () => ({ set: idb.set }))
vi.mock('frappe-ui', () => ({ useFileUpload: () => ({}), toast: vi.fn() }))

import { setCache } from './files'

/**
 * `setCache` replaces the resource's `setData`, and frappe-ui's offline restore
 * calls exactly that with whatever `saveLocal` persisted — the *raw* response.
 * Since the paginated list endpoints answer with `{rows, has_next}`, the restore
 * would otherwise assign that object straight to `resource.data`, where every
 * consumer expects an array (`GenericPage`'s `rows` computed spreads it).
 */
describe('setCache setData normalises the cached shape', () => {
  beforeEach(() => vi.clearAllMocks())

  it('unwraps a paginated envelope restored from the cache', () => {
    const resource: Record<string, unknown> = { data: null }
    setCache(resource, 'folder-contents')

    resource.setData({
      rows: [{ name: 'a' }, { name: 'b' }],
      has_next: true,
    })

    expect(Array.isArray(resource.data)).toBe(true)
    expect(resource.data).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  it('passes a plain array through untouched', () => {
    const resource: Record<string, unknown> = { data: null }
    setCache(resource, 'folder-contents')

    const rows = [{ name: 'a' }]
    resource.setData(rows)

    expect(resource.data).toEqual(rows)
  })

  it('still supports the updater-function form', () => {
    const resource: Record<string, unknown> = { data: [{ name: 'a' }] }
    setCache(resource, 'folder-contents')

    resource.setData((d: unknown[]) => d.filter((r) => (r as { name: string }).name !== 'a'))

    expect(resource.data).toEqual([])
  })

  it('tolerates a cached value with no rows', () => {
    const resource: Record<string, unknown> = { data: null }
    setCache(resource, 'folder-contents')

    resource.setData({ has_next: false })

    expect(resource.data).toEqual([])
  })
})
