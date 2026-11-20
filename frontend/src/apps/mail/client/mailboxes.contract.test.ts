import { expect, it } from 'vitest'

import { operationGetMailboxes } from './validators'

// The whole folder list is refused if one row doesn't fit, which empties the sidebar and every list.
it('accepts a Snoozed folder in the mailbox list', () => {
  const snoozed = {
    name: 'h|l',
    id: 'l',
    _name: 'Snoozed',
    role: 'snoozed',
    total_emails: 1,
    total_threads: 1,
    unread_threads: 1,
    subscribed: true,
    slug: 'snoozed',
  }
  expect(() => operationGetMailboxes.validateOutput([snoozed])).not.toThrow()
})
