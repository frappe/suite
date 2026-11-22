import { expect, it, vi } from 'vitest'

import type { InboxTab, InboxTabId } from './useInboxTabs'

vi.mock('@/api', () => ({ api: {}, useQuery: () => ({}) }))
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => ({}) }))
vi.mock('@/apps/mail/utils/composables', () => ({ useScreenSize: () => ({}) }))

const { byLatestMail } = await import('./useCategoryCards')

const tab = (id: InboxTabId): InboxTab => ({ id, label: id, icon: '', unread: 0 })

it('orders the tabs by newest mail, keeping Primary first and All mail last', () => {
  const tabs = ['primary', 'updates', 'forums', 'promotions', 'social', 'all'].map((id) =>
    tab(id as InboxTabId),
  )
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
