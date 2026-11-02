import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'

import type { DocumentThread } from '@/apps/drive'

import { keepSeen, readSeen, useSeenThreads } from './seenThreads'

const scopes: ReturnType<typeof effectScope>[] = []

afterEach(() => {
  for (const scope of scopes.splice(0)) {
    scope.stop()
  }

  vi.restoreAllMocks()
  localStorage.clear()
})

function said(name: string, modified: string) {
  return { name, content: name, modified }
}

function thread(
  name: string,
  comments: object[] = [said(`${name}-1`, '2026-10-01 09:00:00')],
  isResolved = false,
) {
  return { name, resolved: isResolved, comments } as unknown as DocumentThread
}

const FIRST = thread('first')
const SECOND = thread('second')

// The threads as this person sees them on this device, with one open or none
function watchThreads(listed: DocumentThread[], readAt = ref<number | null>(1)) {
  const threads = shallowRef(listed)
  const open = ref<string | null>(null)
  const scope = effectScope()
  scopes.push(scope)
  const seen = scope.run(() =>
    useSeenThreads({
      user: 'ann',
      node: 'doc-1',
      threads: () => threads.value,
      readAt: () => readAt.value,
      openThread: () => open.value,
    }),
  )!
  function unread() {
    return threads.value.filter(seen.isUnread).map((shown) => shown.name)
  }

  return { threads, open, seen, unread }
}

const KEY = 'suite:writer-seen-threads:ann:doc-1'
const REPLIED = thread('first', [...FIRST.comments, said('first-2', '2026-10-01 10:00:00')])

describe('the marks kept on this device', () => {
  it('reads back what was kept, per person and document', () => {
    keepSeen('ann', 'doc-1', { first: { mark: '1::false', at: 1 } })

    expect([readSeen('ann', 'doc-1'), readSeen('ann', 'doc-2'), readSeen('ben', 'doc-1')]).toEqual([
      { first: { mark: '1::false', at: 1 } },
      null,
      null,
    ])
  })

  it('reads nothing from words that are not marks, and drops marks of another shape, older plain ones too', () => {
    const marks =
      '{"first":{"mark":"1::false","at":1},"second":"1::false","third":{"mark":"1::false"}}'
    const read: unknown[] = []
    for (const stored of ['{broken', '[]', '"text"', marks]) {
      localStorage.setItem(KEY, stored)
      read.push(readSeen('ann', 'doc-1'))
    }

    expect(read).toEqual([null, null, null, { first: { mark: '1::false', at: 1 } }])
  })

  it('keeps nothing, without throwing, when storage is blocked, and follows this tab alone', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    keepSeen('ann', 'doc-1', { first: { mark: '1::false', at: 1 } })
    const { unread, threads, seen } = watchThreads([FIRST, SECOND])
    threads.value = [thread('first', [said('first-1', '2026-10-02 09:00:00')]), SECOND]
    const changed = unread()
    seen.markSeen('first')

    expect([readSeen('ann', 'doc-1'), changed, unread()]).toEqual([null, ['first'], []])
  })
})

describe('which threads changed since last opened', () => {
  it('shows none unread on a document first opened on this device, and keeps that', () => {
    const { unread } = watchThreads([FIRST, SECOND])

    expect([unread(), Object.keys(readSeen('ann', 'doc-1') ?? {})]).toEqual([
      [],
      ['first', 'second'],
    ])
  })

  it('keeps nothing while the threads load or fail to, then starts with every thread seen', async () => {
    const readAt = ref<number | null>(null)
    const { threads, unread } = watchThreads([], readAt)
    await nextTick()
    const whileLoading = readSeen('ann', 'doc-1')

    threads.value = [FIRST, SECOND]
    readAt.value = 1
    await nextTick()

    expect([whileLoading, unread(), Object.keys(readSeen('ann', 'doc-1') ?? {})]).toEqual([
      null,
      [],
      ['first', 'second'],
    ])
  })

  it('shows a thread unread after a new reply, an edit, a deleted comment, a resolve or a reopen', async () => {
    const [opening, reply] = [
      said('first-1', '2026-10-01 09:00:00'),
      said('first-2', '2026-10-01 10:00:00'),
    ]
    const replied = thread('first', [opening, reply])
    const changes = [
      thread('first', [opening, reply, said('first-3', '2026-10-01 11:00:00')]),
      thread('first', [opening, said('first-2', '2026-10-01 11:00:00')]),
      thread('first', [reply]),
      thread('first', replied.comments, true),
    ]
    const seenAs: string[][] = []
    for (const changed of changes) {
      const { threads, unread } = watchThreads([replied])
      threads.value = [changed]
      await nextTick()
      seenAs.push(unread())
      localStorage.clear()
    }

    const { threads, unread } = watchThreads([thread('first', FIRST.comments, true)])
    threads.value = [FIRST]
    seenAs.push(unread())

    expect(seenAs).toEqual([['first'], ['first'], ['first'], ['first'], ['first']])
  })

  it('shows a thread started since unread, and the others as they were', () => {
    watchThreads([FIRST])

    const { unread } = watchThreads([FIRST, SECOND])

    expect(unread()).toEqual(['second'])
  })

  it('keeps the open thread seen as replies arrive, and clears one once opened', async () => {
    const { threads, open, unread } = watchThreads([FIRST, SECOND])
    open.value = 'first'
    await nextTick()

    threads.value = [
      thread('first', [...FIRST.comments, said('first-2', '2026-10-01 10:00:00')]),
      thread('second', [...SECOND.comments, said('second-2', '2026-10-01 10:00:00')]),
    ]
    await nextTick()
    const whileOpen = unread()
    open.value = 'second'
    await nextTick()

    expect([whileOpen, unread()]).toEqual([['second'], []])
  })

  it('keeps a thread seen across a reload once opened', async () => {
    const { threads, seen } = watchThreads([FIRST, SECOND])
    threads.value = [thread('first', [...FIRST.comments, said('first-2', '2026-10-01 10:00:00')])]

    seen.markSeen('first')
    const { unread } = watchThreads(threads.value)

    expect(unread()).toEqual([])
  })

  it('clears a thread here once another tab on this device opens it', () => {
    const { threads, unread } = watchThreads([FIRST])
    threads.value = [thread('first', [...FIRST.comments, said('first-2', '2026-10-01 10:00:00')])]
    const before = unread()
    const { seen: otherTab } = watchThreads(threads.value)
    const oldValue = localStorage.getItem('suite:writer-seen-threads:ann:doc-1')

    otherTab.markSeen('first')
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'suite:writer-seen-threads:ann:doc-1',
        oldValue,
        newValue: localStorage.getItem('suite:writer-seen-threads:ann:doc-1'),
      }),
    )

    expect([before, unread()]).toEqual([['first'], []])
  })

  it('keeps what another tab opened when this tab opens a thread, before the other tab’s word arrives', () => {
    const replied = [
      thread('first', [...FIRST.comments, said('first-2', '2026-10-01 10:00:00')]),
      thread('second', [...SECOND.comments, said('second-2', '2026-10-01 10:00:00')]),
    ]
    watchThreads([FIRST, SECOND])
    const { seen: here } = watchThreads(replied)
    const { seen: otherTab } = watchThreads(replied)

    otherTab.markSeen('second')
    here.markSeen('first')
    const { unread } = watchThreads(replied)

    expect(unread()).toEqual([])
  })

  it('keeps the thread open here seen when another tab’s older marks arrive, without writing them back', async () => {
    const { threads, open, unread } = watchThreads([FIRST])
    const older = localStorage.getItem('suite:writer-seen-threads:ann:doc-1')
    open.value = 'first'
    threads.value = [thread('first', [...FIRST.comments, said('first-2', '2026-10-01 10:00:00')])]
    await nextTick()
    localStorage.setItem('suite:writer-seen-threads:ann:doc-1', older!)

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'suite:writer-seen-threads:ann:doc-1', newValue: older }),
    )

    expect([unread(), localStorage.getItem('suite:writer-seen-threads:ann:doc-1')]).toEqual([
      [],
      older,
    ])
  })

  it('keeps its marks when another document’s marks change on this device', () => {
    const { unread } = watchThreads([FIRST])

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'suite:writer-seen-threads:ann:doc-2', newValue: '{}' }),
    )

    expect(unread()).toEqual([])
  })

  it('keeps the mark from threads read later, though a tab with older threads opens the thread after', async () => {
    const stale = watchThreads([FIRST], ref<number | null>(1000))
    const newer = watchThreads([REPLIED], ref<number | null>(2000))
    newer.open.value = 'first'
    await nextTick()

    stale.open.value = 'first'
    await nextTick()
    const { unread } = watchThreads([REPLIED], ref<number | null>(3000))

    expect(unread()).toEqual([])
  })

  it('keeps its later mark when a tab with older threads overwrites it, not having read it yet', async () => {
    const stale = watchThreads([FIRST], ref<number | null>(1000))
    const before = localStorage.getItem(KEY)
    const newer = watchThreads([REPLIED], ref<number | null>(2000))
    newer.open.value = 'first'
    await nextTick()
    newer.open.value = null
    await nextTick()

    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(before)
    stale.open.value = 'first'
    await nextTick()
    getItem.mockRestore()
    window.dispatchEvent(
      new StorageEvent('storage', { key: KEY, newValue: localStorage.getItem(KEY) }),
    )

    expect(newer.unread()).toEqual([])
  })

  it('keeps the open thread seen when a tab with later threads saw it as changed', async () => {
    const { open, unread } = watchThreads([FIRST], ref<number | null>(1000))
    open.value = 'first'
    await nextTick()
    const newer = watchThreads([REPLIED], ref<number | null>(2000))

    newer.seen.markSeen('first')
    window.dispatchEvent(
      new StorageEvent('storage', { key: KEY, newValue: localStorage.getItem(KEY) }),
    )

    expect([unread(), readSeen('ann', 'doc-1')?.first.mark]).toEqual([
      [],
      '2:2026-10-01 10:00:00:false',
    ])
  })

  it('leaves a reply to the thread open in a hidden page unseen until the page is shown again', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const readAt = ref<number | null>(1)
    const { threads, open } = watchThreads([FIRST], readAt)
    open.value = 'first'
    await nextTick()
    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()

    threads.value = [REPLIED]
    readAt.value = 2
    await nextTick()
    const whileHidden = watchThreads([REPLIED], ref<number | null>(3)).unread()
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()

    expect([whileHidden, watchThreads([REPLIED], ref<number | null>(3)).unread()]).toEqual([
      ['first'],
      [],
    ])
  })
})
