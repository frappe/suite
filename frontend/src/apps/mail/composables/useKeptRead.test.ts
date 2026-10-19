import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import type { Thread } from '@/apps/mail/types'

import { useKeptRead } from './useKeptRead'

const row = (id: string, at: string, seen: 0 | 1 = 0) =>
  ({ thread_id: id, received_at: at, seen }) as unknown as Thread
const ids = (rows: Thread[]) => rows.map((r) => r.thread_id)

const setUp = () => {
  const filter = ref<string | null>('unread')
  const folder = ref('inbox')
  const kept = useKeptRead({
    filtering: () => !!filter.value?.split(',').includes('unread'),
    scope: () => [folder.value, filter.value],
    key: (thread) => thread.thread_id,
  })
  return { filter, folder, ...kept }
}

// The server's answers: unread mail, newest first.
const before = [row('c', '2026-10-03'), row('b', '2026-10-02'), row('a', '2026-10-01')]
const bRead = [row('c', '2026-10-03'), row('b', '2026-10-02', 1), row('a', '2026-10-01')]
const withoutB = [row('c', '2026-10-03'), row('a', '2026-10-01')]

describe('read in a list filtered to unread mail', () => {
  it('stays, in its place, after the server stops listing it', () => {
    const { keep, withKept } = setUp()
    keep(withKept(before))
    keep(withKept(bRead))
    expect(ids(withKept(withoutB))).toEqual(['c', 'b', 'a'])
    expect(withKept(withoutB)[1].seen).toBe(1)
  })

  it('goes when an action takes it off the list', () => {
    const { keep, release, withKept } = setUp()
    keep(bRead)
    release(['b'])
    expect(ids(withKept(withoutB))).toEqual(['c', 'a'])
  })

  it('goes when the folder or the filter changes', async () => {
    const { keep, withKept, folder } = setUp()
    keep(bRead)
    folder.value = 'archive'
    await nextTick()
    expect(ids(withKept(withoutB))).toEqual(['c', 'a'])
  })

  it('keeps nothing in a list not filtered to unread mail', () => {
    const { keep, withKept, filter } = setUp()
    filter.value = 'starred'
    keep(bRead)
    filter.value = 'unread'
    expect(ids(withKept(withoutB))).toEqual(['c', 'a'])
  })

  it('is let go when made unread, and kept as read again when read again', () => {
    const { keep, withKept } = setUp()
    keep(bRead)
    // Marked unread: the server lists it again, unread.
    keep(before)
    expect(withKept(before)[1].seen).toBe(0)
    // Read again, then gone from the server's answer: it comes back read.
    keep(bRead)
    expect(withKept(withoutB)[1].seen).toBe(1)
  })

  it('settles: keeping the rows it shows changes nothing', async () => {
    const { keep, withKept } = setUp()
    keep(bRead)
    const shown = withKept(withoutB).map((r) => ({ ...r }))
    const changed = { count: 0 }
    const { watch } = await import('vue')
    const stop = watch(
      () => withKept(withoutB),
      () => changed.count++,
    )
    keep(shown)
    await nextTick()
    stop()
    expect(changed.count).toBe(0)
  })

  it('is put back only on the list it was taken off', async () => {
    const { keep, release, restore, current, withKept, filter } = setUp()
    keep(bRead)
    release(['b'])
    const at = current()
    filter.value = 'unread,starred'
    await nextTick()
    restore(bRead, at)
    expect(ids(withKept(withoutB))).toEqual(['c', 'a'])
  })
})
