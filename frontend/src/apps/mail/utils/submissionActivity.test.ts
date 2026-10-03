import { beforeAll, describe, expect, it, vi } from 'vitest'

import dayjs from '@/apps/mail/utils/dayjs'

import type { RecipientState, SubmissionDetails } from './submission'

vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ userResource: { data: { time_zone: 'UTC' } } }),
}))

// Times below are asserted in UTC, whatever zone the machine running the tests is in.
vi.spyOn(dayjs.tz, 'guess').mockReturnValue('UTC')

// `__` is installed on window by the translation plugin at app boot; the helpers format their
// arguments through it, so the stand-in must substitute {n} placeholders too.
beforeAll(() => {
  window.__ = (message: string, args: string[] = []) =>
    message.replace(/\{(\d+)\}/g, (_, index) => args[Number(index)])
})

const load = async () => await import('./submissionActivity')

const recipient = (email: string, overrides: Partial<RecipientState> = {}): RecipientState => ({
  email,
  status: 'sent',
  ...overrides,
})

const details = (overrides: Partial<SubmissionDetails> = {}): SubmissionDetails => ({
  id: '9',
  email_id: 'wneaaaftj',
  thread_id: 'ftj',
  subject: 'Invoice #2219 for July services',
  from_name: 'John Doe',
  from_email: 'j.doe@example.com',
  recipients: [],
  recipients_status: [recipient('bob@example.com')],
  send_at: '2026-08-31T08:00:00Z',
  undo_status: 'final',
  status: 'sent',
  retries: null,
  delivery_errors: [],
  email_deleted: false,
  envelope_recipients: ['bob@example.com'],
  priority: 0,
  dsn_count: 0,
  mdn_count: 0,
  ...overrides,
})

const titles = (entries: { title: string }[]) => entries.map((e) => e.title)

describe('statusSummary', () => {
  it('names the release time of a scheduled send', async () => {
    const { statusSummary } = await load()
    expect(statusSummary(details({ status: 'scheduled' }))).toMatch(
      /^Sends Aug 31 2026, 8:00 AM \(/,
    )
  })

  it('names the next attempt while retrying, or the fact that the server keeps trying', async () => {
    const { statusSummary } = await load()
    const retrying = details({ status: 'retrying', next_retry: '2026-08-31T08:42:00Z' })
    expect(statusSummary(retrying)).toMatch(/^Next attempt Aug 31 2026, 8:42 AM \(/)
    expect(statusSummary(details({ status: 'retrying' }))).toBe('The mail server will keep trying')
  })

  it('counts the failed recipients', async () => {
    const { statusSummary } = await load()
    const failed = details({
      status: 'failed',
      recipients_status: [
        recipient('a@example.com', { status: 'failed' }),
        recipient('b@example.com', { status: 'delivered' }),
        recipient('c@example.com'),
      ],
    })
    expect(statusSummary(failed)).toBe('Could not be delivered to 1 of 3 recipients')
    expect(
      statusSummary(
        details({
          status: 'failed',
          recipients_status: [recipient('a@example.com', { status: 'failed' })],
        }),
      ),
    ).toBe('Could not be delivered')
  })

  it('counts the read receipts among delivered recipients', async () => {
    const { statusSummary } = await load()
    const delivered = details({
      status: 'delivered',
      recipients_status: [
        recipient('a@example.com', { status: 'displayed' }),
        recipient('b@example.com', { status: 'delivered' }),
      ],
    })
    expect(statusSummary(delivered)).toBe('Delivered to all 2 recipients, read by 1')
    expect(
      statusSummary(
        details({
          status: 'delivered',
          recipients_status: [recipient('a@example.com', { status: 'delivered' })],
        }),
      ),
    ).toBe('Delivery confirmed')
  })

  it('names the release a cancelled send was meant to have', async () => {
    const { statusSummary } = await load()
    expect(statusSummary(details({ status: 'cancelled' }))).toBe(
      'Was scheduled for Aug 31 2026, 8:00 AM',
    )
  })
})

describe('activityEntries', () => {
  it('tells a scheduled send as the release still to come', async () => {
    const { activityEntries } = await load()
    const entries = activityEntries(
      details({
        status: 'scheduled',
        recipients_status: [recipient('bob@example.com', { status: 'scheduled' })],
      }),
    )
    expect(titles(entries)).toEqual(['Release to the mail server'])
    expect(entries[0]).toMatchObject({ pending: true, time: '2026-08-31T08:00:00Z', theme: 'blue' })
    expect(entries[0].detail).toMatch(/· 1 recipient$/)
  })

  it('tells a plain send as its release and what each recipient got', async () => {
    const { activityEntries } = await load()
    expect(titles(activityEntries(details()))).toEqual([
      'Released to the mail server',
      'Accepted for bob@example.com',
    ])
  })

  it('tells each recipient where its delivery stands, then the next attempt', async () => {
    const { activityEntries } = await load()
    const entries = activityEntries(
      details({
        status: 'retrying',
        next_retry: '2026-08-31T08:42:00Z',
        priority: 4,
        recipients_status: [
          recipient('bob@example.com', { smtp_reply: '250 2.1.5 Queued' }),
          recipient('priya@example.com', {
            status: 'retrying',
            reason: '451 4.7.1 Greylisted',
            retries: 2,
          }),
          recipient('marcus@example.com', { status: 'delivered', smtp_reply: '250 2.0.0 OK' }),
        ],
      }),
    )
    expect(titles(entries)).toEqual([
      'Released to the mail server',
      'Accepted for bob@example.com',
      'Deferred for priya@example.com',
      'Delivered to marcus@example.com',
      'Next attempt',
    ])
    expect(entries[0].detail).toBe('3 recipients · High priority')
    expect(entries[2]).toMatchObject({
      theme: 'amber',
      reply: '451 4.7.1 Greylisted',
      detail: 'Retried 2 times, the server will keep trying',
    })
    expect(entries[4]).toMatchObject({ pending: true, time: '2026-08-31T08:42:00Z' })
  })

  it('tells a cancelled send as just that, undated', async () => {
    const { activityEntries } = await load()
    const entries = activityEntries(details({ status: 'cancelled' }))
    expect(entries).toEqual([
      { key: 'cancelled', title: 'Delivery cancelled', detail: undefined, theme: 'gray' },
    ])
    expect(activityEntries(details({ status: 'cancelled', email_deleted: true }))[0].detail).toBe(
      'The message itself was deleted afterwards',
    )
  })
})
