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
})
