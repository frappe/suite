import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSearchWith } from './composables'
import { withoutFilters } from './searchFilters'

const pushed = vi.hoisted((): unknown[] => [])
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ push: (location: unknown) => pushed.push(location) }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ accountId: 'work', mailboxIds: { inbox: 'inbox-id' } }),
}))
vi.mock('@/apps/mail/router', () => ({ default: {} }))

describe('editing a search on its results page', () => {
  beforeEach(() => (pushed.length = 0))

  it('runs the search as edited while something is left to search', () => {
    useSearchWith()(withoutFilters({ text: 'budget', from: 'ana@x.test' }))
    expect(pushed).toEqual([
      {
        name: 'mail-mailbox',
        params: { accountId: 'work', mailbox: 'search' },
        query: { text: 'budget' },
      },
    ])
  })

  it('leaves for the Inbox once removing the filters leaves nothing to search', () => {
    useSearchWith()(withoutFilters({ from: 'ana@x.test', all_accounts: '1' }))
    expect(pushed).toEqual([
      { name: 'mail-mailbox', params: { accountId: 'work', mailbox: 'inbox-id' } },
    ])
  })
})
