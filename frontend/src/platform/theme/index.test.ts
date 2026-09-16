import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Session } from '@/platform/session'
import type { Transport } from '@/platform/transport'
import { createTheme } from './index'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('theme', () => {
  it('applies and restores scoped overrides without changing the saved mode', async () => {
    document.documentElement.setAttribute('data-theme-mode', 'light')
    const theme = createTheme()
    const releaseDark = theme.withOverride('dark')
    expect(theme.savedMode.value).toBe('light')
    expect(theme.resolvedMode.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    releaseDark()
    expect(theme.resolvedMode.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('cycles the guest preference without making a server request', async () => {
    document.cookie = 'user_id=Guest; path=/'
    document.documentElement.setAttribute('data-theme-mode', 'light')
    const theme = createTheme()
    await theme.cycle()
    expect(theme.savedMode.value).toBe('dark')
  })

  it('reads and writes the Frappe User desk_theme preference', async () => {
    const request = vi.fn<(operation: any, input: any) => Promise<any>>(async (operation) =>
      operation.id === 'frappe.user.get_theme' ? { desk_theme: 'Automatic' } : undefined,
    )
    const session = {
      user: ref({ id: 'user@example.com', fullName: 'User', avatar: null }),
    } as unknown as Session
    const theme = createTheme({ transport: { request } as Transport, session })
    await theme.initialize()
    expect(theme.savedMode.value).toBe('automatic')
    await theme.set('dark')
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'frappe.user.switch_theme' })
    expect(request.mock.calls.at(-1)?.[1]).toEqual({ theme: 'Dark' })
  })

  it('resolves automatic mode when the system appearance changes', async () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: (_event: string, handler: EventListenerOrEventListenerObject) => {
        listener = handler as (event: MediaQueryListEvent) => void
      },
    } as MediaQueryList)))
    document.documentElement.setAttribute('data-theme-mode', 'automatic')
    const theme = createTheme()
    expect(theme.resolvedMode.value).toBe('light')
    listener?.({ matches: true } as MediaQueryListEvent)
    expect(theme.resolvedMode.value).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('keeps nested overrides scoped and restores the latest remaining mode', () => {
    document.documentElement.setAttribute('data-theme-mode', 'light')
    const theme = createTheme()
    const releaseDark = theme.withOverride('dark')
    const releaseLight = theme.withOverride('light')
    expect(theme.resolvedMode.value).toBe('light')
    releaseLight()
    expect(theme.resolvedMode.value).toBe('dark')
    releaseDark()
    expect(theme.resolvedMode.value).toBe('light')
  })

  it('rolls back a saved preference when the server rejects it', async () => {
    const request = vi.fn(async () => { throw new Error('offline') })
    const session = {
      user: ref({ id: 'user@example.com', fullName: 'User', avatar: null }),
    } as unknown as Session
    document.documentElement.setAttribute('data-theme-mode', 'light')
    const theme = createTheme({ transport: { request } as Transport, session })
    await expect(theme.set('dark')).resolves.toBe(false)
    expect(theme.savedMode.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('initializes the server preference once', async () => {
    const request = vi.fn(async () => ({ desk_theme: 'Dark' }))
    const session = {
      user: ref({ id: 'user@example.com', fullName: 'User', avatar: null }),
    } as unknown as Session
    const theme = createTheme({ transport: { request } as Transport, session })
    await Promise.all([theme.initialize(), theme.initialize()])
    expect(request).toHaveBeenCalledOnce()
    expect(theme.savedMode.value).toBe('dark')
  })
})
