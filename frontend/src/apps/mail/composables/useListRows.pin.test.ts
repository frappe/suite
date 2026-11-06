import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { Thread } from '@/apps/mail/types'
import { mailTweaks } from '@/apps/mail/utils/mailTweaks'

import { useListRows } from './useListRows'

const isMobile = ref(false)
vi.mock('@/apps/mail/utils/composables', () => ({ useScreenSize: () => ({ isMobile }) }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ userResource: { data: { group_by_date: 1 } } }),
}))

const row = (id: string, received_at: string, pinned: 0 | 1 = 0) =>
  ({
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
  }) as unknown as Thread

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

  it('heads the group on desktop in the section look, not on a phone or in the others', () => {
    const list = listOf(threads)
    expect(list.groupHeaderVisible('pinned')).toBe(true)
    mailTweaks.pinLook = 'icon'
    expect(list.groupHeaderVisible('pinned')).toBe(false)
    mailTweaks.pinLook = 'section'
    isMobile.value = true
    expect(list.groupHeaderVisible('pinned')).toBe(false)
    isMobile.value = false
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
