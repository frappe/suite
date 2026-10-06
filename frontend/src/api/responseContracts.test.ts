import { describe, expect, it, vi } from 'vitest'

import { api as calendar } from '@/apps/calendar/client/api'
import { api as mail } from '@/apps/mail/client/api'
import { createTransport } from '@/platform/transport'

const participant = {
  uid: 'attendee',
  roles: { attendee: true },
  kind: 'Individual',
  _name: 'Alice',
  email: 'alice@example.com',
  schedule_id: null,
  send_to: null,
  participation_status: 'ACCEPTED',
  expect_reply: 0,
  description: null,
  comment: null,
  schedule_agent: '',
  member_of: {},
}
const event = {
  name: 'account|event',
  account: 'account',
  id: 'event',
  uid: 'event',
  title: 'Planning',
  start: '2026-10-06T09:00:00',
  duration: 'PT1H',
  time_zone: 'Asia/Kolkata',
  status: 'Confirmed',
  description: '',
  show_without_time: 0,
  recurrence_id: null,
  recurrence_rule: null,
  organizer: '',
  calendars: [],
  created: null,
  draft: 0,
  recurrence_id_time_zone: '',
  privacy: '',
  free_busy_status: '',
  locations: [],
  alerts: [],
  use_default_alerts: 0,
  created_utc: '',
  updated_utc: '',
  origin: true,
  may_invite_self: 0,
  may_invite_others: 0,
  hide_attendees: 0,
  creation: '',
  modified: '',
  sequence: 0,
  links: [],
  participants: [participant],
}

function respond(payload: unknown) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify({ message: payload })))
  return createTransport({ fetch: fetcher })
}

describe('Mail and Calendar read contracts', () => {
  it('accepts boolean mailbox subscriptions without weakening their type', async () => {
    const mailbox = {
      name: 'account|inbox',
      id: 'inbox',
      _name: 'Inbox',
      role: 'inbox',
      total_emails: 3,
      total_threads: 2,
      unread_threads: 1,
      slug: 'inbox',
      subscribed: true,
    }
    const rows = [
      mailbox,
      { ...mailbox, id: 'archive', role: 'archive', slug: 'archive', subscribed: false },
    ]
    await expect(
      respond(rows).request(mail.mailboxes.list, { account: 'account' }),
    ).resolves.toEqual(rows)
    await expect(
      respond([{ ...mailbox, subscribed: 'true' }]).request(mail.mailboxes.list, {
        account: 'account',
      }),
    ).rejects.toThrow(/subscribed/)
  })

  it('accepts absent scheduling metadata in event participants and rejects malformed metadata', async () => {
    const input = {
      account: 'account',
      from_date: '2026-10-01',
      to_date: '2026-11-01',
      time_zone: 'Asia/Kolkata',
    }
    const rows = [
      event,
      {
        ...event,
        id: 'scheduled',
        participants: [
          {
            ...participant,
            schedule_id: 'mailto:alice@example.com',
            send_to: { imip: 'mailto:alice@example.com' },
            description: '',
            comment: '',
          },
        ],
      },
    ]
    await expect(respond(rows).request(calendar.events.sharedWindow, input)).resolves.toEqual(rows)
    await expect(
      respond([{ ...event, participants: [{ ...participant, schedule_id: 42 }] }]).request(
        calendar.events.sharedWindow,
        input,
      ),
    ).rejects.toThrow(/schedule_id/)
  })
})
