import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { Thread } from '@/apps/mail/types'

import { useListRows } from './useListRows'

const isMobile = ref(false)
vi.mock('@/apps/mail/utils/composables', () => ({ useScreenSize: () => ({ isMobile }) }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ userResource: { data: { group_by_date: 1 } } }),
}))

const row = (id: string, received_at: string, pinned: 0 | 1 = 0) =>
  fromPartial<Thread>({
    name: id,
    id,
    account: 'a',
    thread_id: id,
    from_email: `${id}@example.test`,
    from_name: id,
    messages: [],
    subject: id,
    received_at,
    seen: 0,
    pinned,
  })

const listOf = (threads: Thread[]) =>
  useListRows({
    threads: () => threads,
    rowKey: (thread: Thread) => thread.thread_id,
    stackingEnabled: () => false,
    openThreadID: () => undefined,
    onOpenThreadHidden: () => {},
    container: ref(null),
  })

describe('a list with pins', () => {
  const threads = [
    row('old-pin', '2024-01-01 10:00:00', 1),
    row('new', '2026-11-04 10:00:00'),
    row('older', '2026-10-01 10:00:00'),
  ]

  it('leads with the pinned group, whatever their dates', () => {
    const groups = listOf(threads).groupedThreads.value
    expect(Object.keys(groups)[0]).toBe('pinned')
    expect(groups.pinned.map((thread: Thread) => thread.thread_id)).toEqual(['old-pin'])
  })

  it('does not list a pinned thread again under its date', () => {
    const groups = listOf(threads).groupedThreads.value
    const ids = Object.values(groups)
      .flat()
      .map((thread: Thread) => thread.thread_id)
    expect(ids.filter((id: string) => id === 'old-pin')).toHaveLength(1)
  })

  it('has no pinned group without pins', () => {
    expect(Object.keys(listOf([threads[1]]).groupedThreads.value)).not.toContain('pinned')
  })
})

describe('the pinned section', () => {
  const threads = [row('pin', '2024-01-01 10:00:00', 1), row('new', '2026-11-04 10:00:00')]
  const walked = () => listOf(threads).navigableRows.value.map((navRow) => navRow.key)

  it('heads the pins on desktop, as the days are headed', () => {
    expect(walked().slice(0, 2)).toEqual(['group:pinned', 'pin'])
  })

  it('leads with the pins as plain rows on a phone, with no header', () => {
    isMobile.value = true
    try {
      expect(walked()).toEqual(['pin', 'new'])
    } finally {
      isMobile.value = false
    }
  })
})

describe('pinning and unpinning in place', () => {
  const inboxOf = (threads: Thread[], hasMore = false) =>
    useListRows({
      threads: () => threads,
      rowKey: (thread: Thread) => thread.thread_id,
      stackingEnabled: () => false,
      pinsLead: () => true,
      hasMore: () => hasMore,
      openThreadID: () => undefined,
      onOpenThreadHidden: () => {},
      container: ref(null),
    })
  const ids = (threads?: Thread[]) => threads?.map((thread: Thread) => thread.thread_id)

  // As the Inbox loaded: the pin first, then newest first. Then the pin is taken off on the click,
  // which changes the row but not where the cache keeps it.
  const unpinned = () => [
    row('was-pinned', '2026-11-04 09:00:00'),
    row('yesterday', '2026-11-05 10:00:00'),
    row('same-day', '2026-11-04 12:00:00'),
    row('day-before', '2026-11-03 10:00:00'),
  ]

  it('puts an unpinned conversation under its own day, by its time, straight away', () => {
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
    const groups = inboxOf(unpinned()).groupedThreads.value

    expect(Object.keys(groups)).toEqual(['day:2026-11-05', 'day:2026-11-04', 'day:2026-11-03'])
    expect(ids(groups['day:2026-11-04'])).toEqual(['same-day', 'was-pinned'])
    vi.useRealTimers()
  })

  it('takes a pinned conversation to the top on the click', () => {
    const threads = [row('newer', '2026-11-05 10:00:00'), row('pin-me', '2026-10-01 10:00:00', 1)]

    expect(Object.keys(inboxOf(threads).groupedThreads.value)[0]).toBe('pinned')
  })

  it('lets an unpinned conversation go until its page loads, if it belongs past what is loaded', () => {
    const threads = [row('was-pinned', '2025-01-01 10:00:00'), ...unpinned().slice(1)]
    const shown = Object.values(inboxOf(threads, true).groupedThreads.value).flat()

    expect(ids(shown)).toEqual(['yesterday', 'same-day', 'day-before'])
    expect(ids(Object.values(inboxOf(threads, false).groupedThreads.value).flat())).toContain(
      'was-pinned',
    )
  })
})

describe('a list with mail back from waiting', () => {
  it('lists it under the pins and ahead of the dates', () => {
    const threads = [
      { ...row('pin', '2024-01-01 10:00:00', 1) },
      { ...row('back', '2025-01-01 10:00:00'), returned: 1 as const },
      row('new', '2026-11-04 10:00:00'),
    ]
    const groups = listOf(threads).groupedThreads.value

    expect(Object.keys(groups).slice(0, 2)).toEqual(['pinned', 'returned'])
    expect(groups.returned.map((thread: Thread) => thread.thread_id)).toEqual(['back'])
  })

  it('lists pinned mail that came back with the pins, once', () => {
    const both = [{ ...row('both', '2025-01-01 10:00:00', 1), returned: 1 as const }]
    const groups = listOf(both).groupedThreads.value

    expect(Object.keys(groups)).toEqual(['pinned'])
  })
})
