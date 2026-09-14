import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Transport } from '@/platform/transport'
import { ACCOUNT_REQUEST_PATH, createSession, hasCapabilities, missingCapabilities } from './index'

afterEach(() => {
  document.cookie = 'user_id=Guest; path=/'
  document.cookie = 'full_name=; path=/'
})

describe('session', () => {
  it('boots identity synchronously from cookies and refreshes the account route', async () => {
    document.cookie = 'user_id=user%40example.com; path=/'
    document.cookie = 'full_name=Cookie%20Name; path=/'
    const request = vi.fn(async (operation) => {
      expect(operation.path).toBe(ACCOUNT_REQUEST_PATH)
      return {
        name: 'user@example.com', full_name: 'Server Name', avatar: '/avatar.png',
        roles: ['System Manager'], is_jmap_configured: true,
      }
    })
    const session = createSession({ request } as Transport)
    expect(session.user.value?.fullName).toBe('Cookie Name')
    await session.refresh()
    expect(session.status.value).toBe('authenticated')
    expect(session.user.value).toMatchObject({ id: 'user@example.com', fullName: 'Server Name' })
    expect(session.capabilities.value).toEqual({ jmap: true, systemManager: true })
    expect(hasCapabilities(['jmap'], session)).toBe(true)
    expect(missingCapabilities(['jmap', 'systemManager'], session)).toEqual([])
  })

  it('logs in, refreshes, and logs out through transport', async () => {
    document.cookie = 'user_id=Guest; path=/'
    const request = vi.fn(async (operation) => {
      if (operation.id === 'frappe.login') return {}
      if (operation.id === 'frappe.logout') return {}
      return { name: 'new@example.com', full_name: 'New User', roles: [] }
    })
    const session = createSession({ request } as Transport)
    await session.login('new@example.com', 'secret')
    expect(session.user.value?.id).toBe('new@example.com')
    await session.logout()
    expect(session.status.value).toBe('guest')
    expect(request.mock.calls.map(([operation]) => operation.id)).toContain('frappe.logout')
  })
})
