import { fromPartial } from '@total-typescript/shoehorn'
import { toast } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DocumentSession } from '@/apps/drive'

import { useDocumentPanel } from './useDocumentPanel'

vi.mock('frappe-ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// A Drive session that records the versions taken
function versionsSession() {
  const taken: [string | undefined, string | undefined][] = []
  const session = fromPartial<Pick<DocumentSession, 'comments' | 'versions'>>({
    comments: { list: vi.fn(), create: vi.fn() },
    versions: {
      list: vi.fn(() => Promise.resolve({ rows: [], next_cursor: null })),
      create: vi.fn((kind?: string, label?: string) => {
        taken.push([kind, label])
        return Promise.resolve()
      }),
    },
  })
  return { session, taken }
}

async function noRefresh() {}

afterEach(() => vi.clearAllMocks())

describe('saving a named version', () => {
  it('takes the version only after the edits are saved', async () => {
    const { session, taken } = versionsSession()
    const order: string[] = []
    async function saveFirst() {
      await Promise.resolve()
      order.push(`saved before ${taken.length} versions`)
    }

    const isTaken = await useDocumentPanel(session, noRefresh).saveVersion('Draft one', saveFirst)

    expect([isTaken, order, taken]).toEqual([
      true,
      ['saved before 0 versions'],
      [['named', 'Draft one']],
    ])
  })

  it('takes no version when the edits could not be saved, and says why', async () => {
    const { session, taken } = versionsSession()
    async function saveFirst() {
      throw new Error('No version was taken: saving is paused.')
    }

    const isTaken = await useDocumentPanel(session, noRefresh).saveVersion('Draft one', saveFirst)

    expect([isTaken, taken, vi.mocked(toast.error).mock.calls]).toEqual([
      false,
      [],
      [['No version was taken: saving is paused.']],
    ])
  })
})

// A Drive session listing an automatic and a named version, whose renames go in or are refused
function renamingSession(refusal?: string) {
  const sent: [string, Parameters<DocumentSession['versions']['update']>[1]][] = []
  const rows = [
    { seq: 2, kind: 'auto', label: null, pinned: 0 },
    { seq: 3, kind: 'named', label: 'Draft one', pinned: 0 },
  ]
  const session = fromPartial<Pick<DocumentSession, 'comments' | 'versions'>>({
    comments: {},
    versions: {
      list: () => Promise.resolve({ rows, next_cursor: null }),
      update: (seq: string, changes: Parameters<DocumentSession['versions']['update']>[1]) => {
        sent.push([seq, changes])
        if (refusal) {
          return Promise.reject(new Error(refusal))
        }

        return Promise.resolve()
      },
    },
  })
  return { session, sent }
}

async function renameRow(refusal: string | undefined, seq: number, label: string) {
  const { session, sent } = renamingSession(refusal)
  const panel = useDocumentPanel(session, noRefresh)
  await panel.load('versions')
  const version = panel.lists.versions.find((row) => row.seq === seq)!
  const renamed = await panel.renameVersion(version, label)
  const shown = panel.lists.versions.map((row) => ({
    seq: row.seq,
    label: row.label,
    pinned: row.pinned,
  }))
  return { renamed, sent, shown }
}

describe('renaming a version', () => {
  it('names an automatic version and keeps it from being thinned', async () => {
    const { renamed, sent, shown } = await renameRow(undefined, 2, 'Before the review')

    expect([renamed?.label, sent, shown]).toEqual([
      'Before the review',
      [['2', { label: 'Before the review', pinned: true }]],
      [
        { seq: 2, label: 'Before the review', pinned: 1 },
        { seq: 3, label: 'Draft one', pinned: 0 },
      ],
    ])
  })

  it('changes only the name of a named version', async () => {
    const { sent, shown } = await renameRow(undefined, 3, 'Draft two')

    expect([sent, shown]).toEqual([
      [['3', { label: 'Draft two' }]],
      [
        { seq: 2, label: null, pinned: 0 },
        { seq: 3, label: 'Draft two', pinned: 0 },
      ],
    ])
  })

  it('says why Drive refused the name and keeps the list as it was', async () => {
    const { renamed, shown } = await renameRow('You can’t edit this document.', 3, 'Draft two')

    expect([renamed, shown[1], vi.mocked(toast.error).mock.calls]).toEqual([
      null,
      { seq: 3, label: 'Draft one', pinned: 0 },
      [['You can’t edit this document.']],
    ])
  })

  it('reads the list again and says the version is gone when Drive no longer has it', async () => {
    const rows = [
      { seq: 2, kind: 'auto', label: null, pinned: 0 },
      { seq: 3, kind: 'named', label: 'Draft one', pinned: 0 },
    ]
    const session = fromPartial<Pick<DocumentSession, 'comments' | 'versions'>>({
      comments: {},
      versions: {
        list: vi
          .fn()
          .mockResolvedValueOnce({ rows, next_cursor: null })
          .mockResolvedValueOnce({ rows: rows.slice(1), next_cursor: null }),
        update: () =>
          Promise.reject(
            Object.assign(new Error('Drive version 2 was not found'), { type: 'DriveNotFound' }),
          ),
      },
    })
    const panel = useDocumentPanel(session, noRefresh)
    await panel.load('versions')

    const renamed = await panel.renameVersion(panel.lists.versions[0]!, 'Before the review')

    expect([
      renamed,
      panel.lists.versions.map((row) => row.seq),
      vi.mocked(toast.error).mock.calls,
    ]).toEqual([null, [3], [['This version no longer exists.']]])
  })
})
