import { expect, it, vi } from 'vitest'

import type { InboxTab, InboxTabId } from './useInboxTabs'

vi.mock('@/api', () => ({ api: {}, useQuery: () => ({}) }))
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => ({}) }))

const { byLatestMail, cardFor } = await import('./useCategoryCards')

const tab = (id: InboxTabId): InboxTab => ({ id, label: id, icon: '', unread: 0 })

it('orders the tabs by newest mail, keeping Primary first and All mail last', () => {
  const ids: InboxTabId[] = ['primary', 'updates', 'forums', 'promotions', 'social', 'all']
  const tabs = ids.map(tab)
  // Social's newest mail is the newest; Updates has not loaded yet.
  const cards = [tab('social'), tab('forums'), tab('promotions')].map((t) => ({
    tab: t,
    senders: [],
  }))
  expect(byLatestMail(tabs, cards).map((t) => t.id)).toEqual([
    'primary',
    'social',
    'forums',
    'promotions',
    'updates',
    'all',
  ])
})

it('dates a card by its newest mail, not the pinned mail the Inbox lists first', () => {
  // As the Inbox lists them: a pinned thread from last month, then the rest newest first.
  const card = cardFor(tab('updates'), [
    { received_at: '2026-10-20T09:00:00Z', from_name: 'Old Pin', from_email: 'pin@example.com' },
    { received_at: '2026-11-21T09:00:00Z', from_name: 'Dana', from_email: 'dana@example.com' },
    { received_at: '2026-11-19T09:00:00Z', from_name: '', from_email: 'lee@example.com' },
  ])

  expect(card.latest).toBe('2026-11-21T09:00:00Z')
  expect(card.senders).toEqual(['Dana', 'lee', 'Old Pin'])
})
