import { expect, it } from 'vitest'

import { operationGetThread, operationGetThreads } from './validators'

// Mail can arrive with no From header at all. A page is refused whole if one row doesn't fit, so one
// such message in a folder made the folder unreadable.
const withoutSender = {
  name: 'h|m1',
  id: 'm1',
  thread_id: 't1',
  from_name: null,
  from_email: null,
  received_at: '2026-11-18T13:14:54Z',
  mailboxes: [{ mailbox: 'h|s', mailbox_id: 's', mailbox_name: 'Sent' }],
  seen: 1,
  junk: 0,
  flagged: 0,
  draft: 0,
  subject: 'No sender',
  preview: '',
  recipients: [],
  attachments: [],
} as const

it('lists a folder holding a message with no sender', () => {
  const page = { rows: [{ ...withoutSender, messages: [] }], mailbox: 's', has_more: false }
  expect(() => operationGetThreads.validateOutput(page)).not.toThrow()
})

it('opens a thread holding a message with no sender', () => {
  const message = {
    ...withoutSender,
    message_id: null,
    in_reply_to: null,
    reacts_with: [],
    mailing_list: 0,
    html_body: null,
    text_body: null,
    reply_to: [],
    dsn_blob_id: null,
  }
  expect(() => operationGetThread.validateOutput([message])).not.toThrow()
})
