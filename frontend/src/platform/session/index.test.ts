import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Transport } from '@/platform/transport'

import { ACCOUNT_REQUEST_PATH, createSession, hasCapabilities, missingCapabilities } from './index'

afterEach(() => {
  document.cookie = 'user_id=Guest; path=/'
  document.cookie = 'full_name=; path=/'
  document.cookie = 'system_user=; path=/'
})

describe('session', () => {
  it('boots identity synchronously from cookies and refreshes the account route', async () => {
    document.cookie = 'user_id=user%40example.com; path=/'
    document.cookie = 'full_name=Cookie%20Name; path=/'
    const request = vi.fn(async (operation) => {
      expect(operation.prefix + operation.path).toBe(ACCOUNT_REQUEST_PATH)
      return {
        name: 'user@example.com',
        full_name: 'Server Name',
        avatar: '/avatar.png',
        roles: ['System Manager'],
        is_jmap_configured: true,
      }
    })
    const session = createSession({ request } as Transport)
    expect(session.user.value?.fullName).toBe('Cookie Name')
    await session.refresh()
    expect(session.status.value).toBe('authenticated')
    expect(session.user.value).toMatchObject({ id: 'user@example.com', fullName: 'Server Name' })
    expect(session.capabilities.value).toEqual({
      jmap: true,
      systemManager: true,
      suiteAdmin: false,
    })
    expect(hasCapabilities(['jmap'], session)).toBe(true)
    expect(missingCapabilities(['jmap', 'systemManager'], session)).toEqual([])
  })

  it('grants no capability before the account route answers, whatever the cookies say', async () => {
    document.cookie = 'user_id=user%40example.com; path=/'
    document.cookie = 'system_user=yes; path=/'
    let answer: (account: Record<string, unknown>) => void = () => {}
    const request = vi.fn(() => new Promise((resolve) => (answer = resolve)))
    const session = createSession({ request } as unknown as Transport)
    expect(session.capabilities.value).toEqual({ jmap: false, systemManager: false })
    answer({ name: 'user@example.com', roles: [] })
    await session.refresh()
    expect(session.capabilities.value).toEqual({
      jmap: false,
      systemManager: false,
      suiteAdmin: false,
    })
  })

  it('grants business administration from Suite Admin independently of System Manager', async () => {
    document.cookie = 'user_id=admin%40example.com; path=/'
    const request = vi.fn(async () => ({
      name: 'admin@example.com',
      roles: { suite_admin: true, system_manager: false },
    }))
    const session = createSession({ request } as unknown as Transport)
    await session.refresh()
    expect(hasCapabilities(['suiteAdmin'], session)).toBe(true)
    expect(hasCapabilities(['systemManager'], session)).toBe(false)
    session.expire()
    expect(hasCapabilities(['suiteAdmin'], session)).toBe(false)
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

  it('runs signed-in cleanups before the server ends the session and the rest after, even when one fails', async () => {
    const order: string[] = []
    const request = vi.fn(async () => {
      order.push('server')
      return {}
    })
    const session = createSession({ request } as Transport)
    session.onLogout(() => {
      order.push('failing')
      throw new Error('cache gone')
    })
    session.onLogout(async () => {
      order.push('clear')
    })
    session.onLogout(
      () => {
        order.push('unsubscribe')
      },
      { whileSignedIn: true },
    )
    const removed = vi.fn()
    session.onLogout(removed)()

    await session.logout()

    expect(order).toEqual(['unsubscribe', 'server', 'failing', 'clear'])
    expect(removed).not.toHaveBeenCalled()
    expect(session.status.value).toBe('guest')
  })

  it('keeps per-user data when the server refuses the logout', async () => {
    const request = vi.fn(async () => {
      throw new Error('offline')
    })
    const session = createSession({ request } as Transport)
    const cleanup = vi.fn()
    session.onLogout(cleanup)

    await expect(session.logout()).rejects.toThrow('offline')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('does not restore an expired identity from an earlier account response', async () => {
    document.cookie = 'user_id=alice'
    let resolveAccount!: (value: unknown) => void
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveAccount = resolve
        }),
    )
    const session = createSession({ request } as Transport)
    const loading = session.refresh()
    session.expire()
    resolveAccount({
      name: 'alice',
      full_name: 'Alice',
      roles: ['System Manager'],
      is_jmap_configured: true,
    })
    await loading
    expect(session.user.value).toBeNull()
    expect(session.status.value).toBe('guest')
    expect(session.capabilities.value).toEqual({ jmap: false, systemManager: false })
  })

  it('keeps guests idle until login supplies an identity', async () => {
    document.cookie = 'user_id=Guest; path=/'
    const request = vi.fn(async () => ({ name: 'user@example.com' }))
    const session = createSession({ request } as Transport)
    await session.refresh()
    expect(session.status.value).toBe('guest')
    expect(session.user.value).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent account refreshes', async () => {
    document.cookie = 'user_id=user%40example.com; path=/'
    let release!: (account: Record<string, unknown>) => void
    const account = new Promise<Record<string, unknown>>((resolve) => (release = resolve))
    const request = vi.fn(() => account)
    const session = createSession({ request } as Transport)
    const first = session.refresh()
    const second = session.refresh()
    expect(request).toHaveBeenCalledOnce()
    release({ name: 'user@example.com', full_name: 'User' })
    await Promise.all([first, second])
    expect(session.status.value).toBe('authenticated')
    expect(request).toHaveBeenCalledOnce()
  })

  it('clears stale identity and capabilities when the account becomes Guest', async () => {
    document.cookie = 'user_id=user%40example.com; path=/'
    const request = vi.fn(async () => ({ name: 'Guest' }))
    const session = createSession({ request } as Transport)
    await session.refresh()
    expect(session.status.value).toBe('guest')
    expect(session.user.value).toBeNull()
    expect(session.capabilities.value).toEqual({ jmap: false, systemManager: false })
  })
})
