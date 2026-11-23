import { describe, expect, it } from 'vitest'

import { homeMailbox } from './recentWith'

const row = (thread_id: string, received_at: string, ...mailboxes: string[]) => ({
  thread_id,
  received_at,
  mailboxes: mailboxes.map((mailbox_id) => ({ mailbox_id })),
})

describe('homeMailbox', () => {
  it('opens a conversation in the first preferred folder it sits in', () => {
    expect(homeMailbox(row('a', '', 'sent', 'inbox'), ['inbox', 'archive', 'sent'])).toBe('inbox')
  })

  it('falls back to wherever the message is', () => {
    expect(homeMailbox(row('a', '', 'receipts'), ['inbox', 'archive'])).toBe('receipts')
  })
})
