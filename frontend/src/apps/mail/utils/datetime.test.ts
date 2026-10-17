import { describe, expect, it, vi } from 'vitest'

import dayjs from '@/apps/mail/utils/dayjs'

vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    userResource: {
      data: { time_zone: 'Asia/Karachi', system_time_zone: 'America/New_York' },
    },
  }),
}))

// The browser zone wins over the User doc's zone; the tests below assert against it.
vi.spyOn(dayjs.tz, 'guess').mockReturnValue('Asia/Kolkata')

const load = async () => await import('@/apps/mail/utils/datetime')

describe('mail datetime helpers', () => {
  it('prefers the browser zone, falling back to the user zone', async () => {
    const { userTimeZone } = await load()
    expect(userTimeZone()).toBe('Asia/Kolkata')
    vi.mocked(dayjs.tz.guess).mockReturnValueOnce(undefined as unknown as string)
    expect(userTimeZone()).toBe('Asia/Karachi')
  })

  it('renders a UTC timestamp in the user zone', async () => {
    const { formatDateTime } = await load()
    expect(formatDateTime('2026-07-28T09:02:30Z')).toBe('Jul 28 2026, 2:32 PM')
  })

  it('fills a datetime-local input in the user zone', async () => {
    const { toLocalInput } = await load()
    expect(toLocalInput('2026-07-28T09:02:30Z')).toBe('2026-07-28T14:32')
  })

  it('reads a datetime-local input back as UTC', async () => {
    const { fromLocalInput } = await load()
    expect(fromLocalInput('2026-07-28T14:32')).toBe('2026-07-28T09:02:00Z')
  })

  it('round-trips through the input format', async () => {
    const { fromLocalInput, toLocalInput } = await load()
    expect(fromLocalInput(toLocalInput('2026-07-28T09:02:00Z'))).toBe('2026-07-28T09:02:00Z')
  })

  it('leaves blanks blank', async () => {
    const { formatDateTime, formatSystemDateTime, fromLocalInput, toLocalInput, utcDayStart } =
      await load()
    expect(formatDateTime(null)).toBe('')
    expect(toLocalInput(undefined)).toBe('')
    expect(fromLocalInput('')).toBe('')
    expect(formatSystemDateTime(null)).toBe('')
    expect(utcDayStart('')).toBe('')
  })

  it('renders a naive system-zone DB timestamp in the user zone', async () => {
    const { formatSystemDateTime } = await load()
    // 09:02:30 EDT (system) = 13:02:30Z = 18:32:30 in Asia/Kolkata (browser).
    expect(formatSystemDateTime('2026-07-28 09:02:30')).toBe('Jul 28 2026, 6:32 PM')
  })

  it('turns a picked day into UTC bounds in the user zone', async () => {
    const { utcDayEnd, utcDayStart } = await load()
    expect(utcDayStart('2026-07-28')).toBe('2026-07-27T18:30:00Z')
    expect(utcDayEnd('2026-07-28')).toBe('2026-07-28T18:29:59Z')
  })
})

describe('formatMessageTime', () => {
  // The translation helper is a global installed at boot; this one fills placeholders only.
  vi.stubGlobal('__', (text: string, args?: string[]) =>
    args ? text.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]) : text,
  )
  // 14 Oct 2026, 3 PM in Kolkata.
  const now = new Date('2026-10-14T09:30:00Z')

  it('gives only the clock for a message from today', async () => {
    const { formatMessageTime } = await load()
    expect(formatMessageTime('2026-10-14T04:30:00Z', now)).toBe('10:00 AM')
  })

  it('names yesterday', async () => {
    const { formatMessageTime } = await load()
    expect(formatMessageTime('2026-10-13T10:45:00Z', now)).toBe('Yesterday, 4:15 PM')
  })

  it('dates an older message by day and month, in the user zone', async () => {
    const { formatMessageTime } = await load()
    // 20:00 UTC on the 8th is already the 9th in Kolkata.
    expect(formatMessageTime('2026-10-08T20:00:00Z', now)).toBe('9 Oct, 1:30 AM')
  })

  it('adds the year to a message from an earlier one', async () => {
    const { formatMessageTime } = await load()
    expect(formatMessageTime('2025-12-31T07:50:00Z', now)).toBe('31 Dec 2025, 1:20 PM')
  })
})

describe('formatListTime', () => {
  vi.stubGlobal('__', (text: string, args?: string[]) =>
    args ? text.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]) : text,
  )
  // 14 Oct 2026, 3 PM in Kolkata.
  const now = new Date('2026-10-14T09:30:00Z')

  it('gives the clock for today, in the user zone', async () => {
    const { formatListTime } = await load()
    expect(formatListTime('2026-10-14T04:30:00Z', now)).toBe('10:00 AM')
  })

  it('names yesterday without a time', async () => {
    const { formatListTime } = await load()
    expect(formatListTime('2026-10-13T10:45:00Z', now)).toBe('Yesterday')
  })

  it('gives day and month this year, and the year before it', async () => {
    const { formatListTime } = await load()
    expect(formatListTime('2026-10-08T20:00:00Z', now)).toBe('9 Oct')
    expect(formatListTime('2025-12-31T07:50:00Z', now)).toBe('31 Dec 2025')
  })

  it('moves on with the clock it is given', async () => {
    const { formatListTime } = await load()
    const tomorrow = new Date('2026-10-15T09:30:00Z')
    expect(formatListTime('2026-10-14T04:30:00Z', tomorrow)).toBe('Yesterday')
  })
})

describe('formatClockTime and formatFullDateTime', () => {
  vi.stubGlobal('__', (text: string, args?: string[]) =>
    args ? text.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]) : text,
  )

  it('gives only the clock, in the user zone', async () => {
    const { formatClockTime } = await load()
    expect(formatClockTime('2026-10-08T20:00:00Z')).toBe('1:30 AM')
  })

  it('gives the whole date, weekday first, in the user zone', async () => {
    const { formatFullDateTime } = await load()
    expect(formatFullDateTime('2026-10-08T20:00:00Z')).toBe('Friday, 9 October 2026 at 1:30 AM')
  })
})
