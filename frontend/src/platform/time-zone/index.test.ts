import dayjs from 'dayjs/esm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createSession } from '@/platform/session'
import type { Transport } from '@/platform/transport'

import { installUserTimeZone, userTimeZone } from './index'

const signedInAs = async (timeZone: string | null) => {
  document.cookie = 'user_id=maya%40example.com; path=/'
  const request = vi.fn(async () => ({
    name: 'maya@example.com',
    full_name: 'Maya Chen',
    avatar: null,
    time_zone: timeZone,
    roles: [],
    is_jmap_configured: true,
  }))
  const session = createSession({ request } as unknown as Transport)
  await session.refresh()
  return session
}

beforeEach(() => {
  const browser = Intl.DateTimeFormat().resolvedOptions()
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...browser,
    timeZone: 'Asia/Kolkata',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = 'user_id=Guest; path=/'
})

describe('userTimeZone', () => {
  it('uses the time zone from Settings over the browser zone', async () => {
    expect(userTimeZone(await signedInAs('America/Los_Angeles'))).toBe('America/Los_Angeles')
  })

  it('falls back to the browser zone when Settings has none', async () => {
    expect(userTimeZone(await signedInAs(null))).toBe('Asia/Kolkata')
  })

  it('makes the Settings zone the dayjs default', async () => {
    installUserTimeZone(await signedInAs('America/Los_Angeles'))
    await nextTick()
    expect(dayjs.tz('2026-07-28 09:00').toISOString()).toBe('2026-07-28T16:00:00.000Z')
  })
})
