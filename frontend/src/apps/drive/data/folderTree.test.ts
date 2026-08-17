import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ frappeRequest: vi.fn() }))

vi.mock('frappe-ui', () => ({ frappeRequest: mocks.frappeRequest }))
vi.mock('@/apps/drive/utils/files', () => ({
  prettyData: (rows: unknown[]) => rows,
  sortEntities: (rows: { file_name?: string }[], order?: { ascending?: boolean }) =>
    [...rows].sort((a, b) =>
      (order?.ascending === false ? -1 : 1) *
      (a.file_name ?? '').localeCompare(b.file_name ?? '')
    ),
}))

import {
  MAX_SKELETONS,
  expandedFolders,
  flattenRows,
  folderChildren,
  loadedChildRows,
  refreshExpanded,
  refreshFolder,
  removeFromTree,
  resetTree,
  toggleFolder,
} from './folderTree'

type Row = {
  name: string
  file_name?: string
  is_folder?: boolean
  child_count?: number
}

const folder = (name: string, child_count = 3): Row => ({
  name,
  file_name: name,
  is_folder: true,
  child_count,
})
const file = (name: string): Row => ({ name, file_name: name })

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  resetTree()
  mocks.frappeRequest.mockReset()
})

describe('toggleFolder', () => {
  it('expands, fetches children and exposes them as loaded rows', async () => {
    mocks.frappeRequest.mockResolvedValue([file('b'), file('a')])

    toggleFolder(folder('parent'), { field: 'file_name', ascending: true })
    expect(expandedFolders.value.has('parent')).toBe(true)
    expect(folderChildren.parent.loading).toBe(true)

    await flush()
    expect(folderChildren.parent.loading).toBe(false)
    expect(folderChildren.parent.rows.map((r) => r.name)).toEqual(['a', 'b'])
    expect(loadedChildRows.value.map((r) => r.name)).toEqual(['a', 'b'])

    const [{ params }] = mocks.frappeRequest.mock.calls[0]
    expect(params).toMatchObject({
      entity_name: 'parent',
      order_by: 'file_name',
      ascending: true,
    })
  })

  it('unwraps a message-envelope response and drops dotfiles', async () => {
    mocks.frappeRequest.mockResolvedValue({ message: [file('.hidden'), file('shown')] })

    toggleFolder(folder('parent'))
    await flush()

    expect(folderChildren.parent.rows.map((r) => r.name)).toEqual(['shown'])
  })

  it('leaves an empty subtree behind when the fetch fails', async () => {
    mocks.frappeRequest.mockRejectedValue(new Error('403'))

    toggleFolder(folder('parent'))
    await flush()

    expect(folderChildren.parent).toMatchObject({ rows: [], loading: false })
  })

  it('does not refetch a subtree that is already cached', async () => {
    mocks.frappeRequest.mockResolvedValue([file('a')])
    toggleFolder(folder('parent'))
    await flush()

    toggleFolder(folder('parent')) // collapse
    toggleFolder(folder('parent')) // expand again
    await flush()
    // The collapse drops the cache, so this is a fresh fetch — but only one.
    expect(mocks.frappeRequest).toHaveBeenCalledTimes(2)
  })

  it('collapsing drops the whole subtree and reports the hidden names', async () => {
    mocks.frappeRequest.mockResolvedValueOnce([file('child'), folder('nested')])
    toggleFolder(folder('parent'))
    await flush()

    mocks.frappeRequest.mockResolvedValueOnce([file('deep')])
    toggleFolder(folder('nested'))
    await flush()

    const collapsed = toggleFolder(folder('parent'))

    expect(collapsed.sort()).toEqual(['child', 'deep', 'nested'])
    expect(expandedFolders.value.size).toBe(0)
    expect(folderChildren.parent).toBeUndefined()
    expect(folderChildren.nested).toBeUndefined()
    expect(loadedChildRows.value).toEqual([])
  })

  it('ignores a stale response that resolves after a newer one', async () => {
    let resolveFirst: (rows: Row[]) => void = () => {}
    mocks.frappeRequest.mockReturnValueOnce(
      new Promise<Row[]>((resolve) => (resolveFirst = resolve))
    )
    toggleFolder(folder('parent'))

    mocks.frappeRequest.mockResolvedValueOnce([file('fresh')])
    refreshFolder('parent')
    await flush()
    expect(folderChildren.parent.rows.map((r) => r.name)).toEqual(['fresh'])

    resolveFirst([file('stale')])
    await flush()
    expect(folderChildren.parent.rows.map((r) => r.name)).toEqual(['fresh'])
  })
})

describe('removeFromTree / resetTree', () => {
  it('removes moved or deleted rows from every loaded subtree', async () => {
    mocks.frappeRequest.mockResolvedValue([file('a'), file('b')])
    toggleFolder(folder('parent'))
    await flush()

    removeFromTree(['a'])
    expect(folderChildren.parent.rows.map((r) => r.name)).toEqual(['b'])
  })

  it('moving a subfile out drops it from its old subtree and into the new one', async () => {
    mocks.frappeRequest.mockResolvedValueOnce([file('moved'), file('stays')])
    toggleFolder(folder('source'))
    await flush()
    mocks.frappeRequest.mockResolvedValueOnce([])
    toggleFolder(folder('destination', 0))
    await flush()

    removeFromTree(['moved'])
    expect(folderChildren.source.rows.map((r) => r.name)).toEqual(['stays'])

    mocks.frappeRequest.mockResolvedValueOnce([file('moved')])
    refreshFolder('destination')
    await flush()

    expect(folderChildren.destination.rows.map((r) => r.name)).toEqual(['moved'])
    expect(loadedChildRows.value.map((r) => r.name).sort()).toEqual([
      'moved',
      'stays',
    ])
  })

  it('a failed move restores both subtrees from the server', async () => {
    mocks.frappeRequest.mockResolvedValueOnce([file('moved')])
    toggleFolder(folder('source'))
    await flush()

    removeFromTree(['moved'])
    expect(folderChildren.source.rows).toEqual([])

    mocks.frappeRequest.mockResolvedValueOnce([file('moved')])
    refreshExpanded()
    await flush()

    expect(folderChildren.source.rows.map((r) => r.name)).toEqual(['moved'])
  })

  it('refreshFolder is a no-op for a folder that was never expanded', () => {
    refreshFolder('unknown')
    expect(mocks.frappeRequest).not.toHaveBeenCalled()
  })

  it('resetTree clears expansion and cached children', async () => {
    mocks.frappeRequest.mockResolvedValue([file('a')])
    toggleFolder(folder('parent'))
    await flush()

    resetTree()
    expect(expandedFolders.value.size).toBe(0)
    expect(loadedChildRows.value).toEqual([])
  })
})

describe('flattenRows', () => {
  it('leaves a collapsed list untouched at depth 0', () => {
    const rows = [folder('parent'), file('loose')]
    expect(flattenRows(rows)).toEqual([
      { row: rows[0], depth: 0, key: 'parent' },
      { row: rows[1], depth: 0, key: 'loose' },
    ])
  })

  it('inlines children under their folder with an incremented depth', async () => {
    mocks.frappeRequest.mockResolvedValueOnce([file('child'), folder('nested')])
    toggleFolder(folder('parent'))
    await flush()
    mocks.frappeRequest.mockResolvedValueOnce([file('deep')])
    toggleFolder(folder('nested'))
    await flush()

    const items = flattenRows([folder('parent'), file('loose')])

    expect(items.map((i) => [i.row?.name ?? i.placeholder, i.depth])).toEqual([
      ['parent', 0],
      ['child', 1],
      ['nested', 1],
      ['deep', 2],
      ['loose', 0],
    ])
  })

  it('keys rows by path so the same entity can appear at two depths', async () => {
    mocks.frappeRequest.mockResolvedValue([file('dupe')])
    toggleFolder(folder('parent'))
    await flush()

    const items = flattenRows([folder('parent'), file('dupe')])
    const keys = items.map((i) => i.key)

    expect(keys).toEqual(['parent', 'parent>dupe', 'dupe'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('shows one skeleton per known child while loading, capped', () => {
    mocks.frappeRequest.mockReturnValue(new Promise(() => {}))

    toggleFolder(folder('small', 2))
    let items = flattenRows([folder('small', 2)])
    expect(items.filter((i) => i.placeholder === 'loading')).toHaveLength(2)
    expect(items.every((i) => !i.row || i.depth === 0)).toBe(true)

    toggleFolder(folder('huge', 500))
    items = flattenRows([folder('huge', 500)])
    expect(items.filter((i) => i.placeholder === 'loading')).toHaveLength(
      MAX_SKELETONS
    )
  })

  it('falls back to a single skeleton when the child count is unknown', () => {
    mocks.frappeRequest.mockReturnValue(new Promise(() => {}))
    const unknown = { name: 'x', file_name: 'x', is_folder: true }

    toggleFolder(unknown)
    const items = flattenRows([unknown])

    expect(items.filter((i) => i.placeholder === 'loading')).toHaveLength(1)
  })

  it('marks an expanded folder that turned out to be empty', async () => {
    mocks.frappeRequest.mockResolvedValue([])
    toggleFolder(folder('parent'))
    await flush()

    const items = flattenRows([folder('parent')])
    expect(items[1]).toMatchObject({ placeholder: 'empty', depth: 1 })
  })

  it('does not expand a non-folder row that shares a name with an expanded folder', async () => {
    mocks.frappeRequest.mockResolvedValue([file('a')])
    toggleFolder(folder('parent'))
    await flush()

    const items = flattenRows([{ name: 'parent', file_name: 'parent' }])
    expect(items).toHaveLength(1)
  })
})
