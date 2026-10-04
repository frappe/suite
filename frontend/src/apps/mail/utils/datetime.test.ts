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
