import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { useGoToShortcuts } from './goToShortcuts'

// The store as the layout sees it: one object whose account changes while the layout stays mounted.
interface StoreHolder {
  current: unknown
}
const store = vi.hoisted((): StoreHolder => ({ current: undefined }))
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => store.current }))

const accountA = {
  accountId: 'a',
  mailboxIds: {
    inbox: 'a-in',
    sent: 'a-sent',
    drafts: 'a-dr',
    junk: 'a-j',
    archive: 'a-ar',
    trash: 'a-t',
  },
}
const accountB = {
  accountId: 'b',
  mailboxIds: {
    inbox: 'b-in',
    sent: 'b-sent',
    drafts: 'b-dr',
    junk: 'b-j',
    archive: 'b-ar',
    trash: 'b-t',
  },
}

describe('g-letter jumps', () => {
  it('stay in the account picked after the shortcuts were set up', () => {
    const state = reactive({ ...accountA })
    store.current = state
    const goTo = useGoToShortcuts()

    Object.assign(state, accountB)

    expect(goTo('i')).toEqual({ name: 'mail-mailbox', params: { accountId: 'b', mailbox: 'b-in' } })
    expect(goTo('s')).toEqual({
      name: 'mail-mailbox',
      params: { accountId: 'b', mailbox: 'b-sent' },
    })
    expect(goTo('f')).toEqual({
      name: 'mail-mailbox',
      params: { accountId: 'b', mailbox: 'starred' },
    })
    expect(goTo('o')).toEqual({ name: 'mail-outbox', params: { accountId: 'b' } })
  })

  it('have no jump on a, so nothing leaves the account for All Inboxes', () => {
    store.current = reactive({ ...accountA })
    expect(useGoToShortcuts()('a')).toBeUndefined()
  })
})
