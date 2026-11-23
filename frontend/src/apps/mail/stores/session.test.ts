import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSession } from '@/platform/session'

vi.mock('@/apps/mail/router', () => ({
  default: { replace: vi.fn(), currentRoute: { value: {} } },
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ userResource: { reload: vi.fn() }, reset: vi.fn() }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload: vi.fn() })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Mail log out', () => {
  it('runs the platform logout, so its cleanups (the push token) run too', async () => {
    const logout = vi.spyOn(useSession(), 'logout').mockResolvedValue()
    const { sessionStore } = await import('@/apps/mail/stores/session')

    await sessionStore().logout.submit()

    expect(logout).toHaveBeenCalledTimes(1)
  })
})
