import { afterEach, expect, it, vi } from 'vitest'

import { loadDevBoot } from './start'

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.csrf_token
  delete window.site_name
})

it('replaces the unrendered token with this session’s boot before requests begin', async () => {
  window.csrf_token = '{{ csrf_token }}'
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ message: { csrf_token: 'session-token', site_name: 'test.localhost' } }),
      ),
    )
  vi.stubGlobal('fetch', fetch)

  await loadDevBoot()

  expect(window.csrf_token).toBe('session-token')
  expect(window.site_name).toBe('test.localhost')
  expect(fetch).toHaveBeenCalledWith('/api/method/suite.www.suite.get_boot_data', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
})

it('starts the page in the saved theme, as the server-rendered page does', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: { csrf_token: 'token', desk_theme: 'Dark' } })),
      ),
  )

  await loadDevBoot()

  expect(document.documentElement.dataset.themeMode).toBe('dark')
  expect('desk_theme' in window).toBe(false)
  delete document.documentElement.dataset.themeMode
})
