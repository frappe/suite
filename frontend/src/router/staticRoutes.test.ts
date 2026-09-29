import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

// The router reads the onboarding state from the server boot when it is present,
// so no request is needed. The session is a stand-in whose status each test sets.
const state = vi.hoisted(() => {
  window.suite_is_onboarded = true
  window.suite_can_onboard = false
  return { status: 'authenticated' as 'guest' | 'authenticated' }
})

vi.mock('@/platform/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/session')>()
  const session = {
    status: {
      get value() {
        return state.status
      },
    },
    user: { value: null },
    capabilities: { value: { jmap: true, systemManager: true } },
    login: async () => {},
    logout: async () => {},
    refresh: async () => {},
  }
  return { ...actual, useSession: () => session }
})

// Writer's route module warms the legacy Drive user list. The list is data,
// not routing, and its module pulls in UI this test environment cannot build.
vi.mock('@/apps/drive/legacy/sdk', () => ({ allUsers: { fetch: () => {} } }))

const { default: router } = await import('./index')

/**
 * Where a navigation settles once the router's own guard has passed it. The
 * probe guard runs after the router's guard and stops the navigation there,
 * so no page component is loaded. A redirect to login never reaches it.
 */
async function settle(path: string): Promise<RouteLocationNormalized | undefined> {
  let settled: RouteLocationNormalized | undefined
  const remove = router.beforeEach((to) => {
    settled = to
    return false
  })
  try {
    await router.push(path)
  } finally {
    remove()
  }
  return settled
}

describe('suite route table', () => {
  afterEach(() => {
    state.status = 'authenticated'
  })

  // Each app's routes load on its first visit. Before that, one lazy group
  // holds the app's whole prefix, so no app URL falls through to Not Found.
  it.each([
    ['/drive', 'drive'],
    ['/slides', 'slides'],
    ['/writer', 'writer'],
    ['/sheets/new', 'sheets'],
    ['/meet/room-1', 'meet'],
  ])('holds %s for the %s app before any navigation', (path, appId) => {
    const resolved = router.resolve(path)
    expect(resolved.name).not.toBe('not-found')
    expect(resolved.meta.appId).toBe(appId)
  })

  it.each([
    ['/mail/login', 'mail'],
    ['/calendar', 'calendar'],
  ])('holds %s for the %s area before any navigation', (path, area) => {
    const resolved = router.resolve(path)
    expect(resolved.name).not.toBe('not-found')
    expect(resolved.meta.area).toBe(area)
  })

  it.each([
    ['/drive', 'drive-Home'],
    ['/sheets/new', 'sheets-editor'],
    ['/calendar', 'calendar-root-shortcut'],
  ])('settles %s on its own route once the app loads', async (path, name) => {
    expect((await settle(path))?.name).toBe(name)
  })

  it.each(['/slides/presentation/demo', '/writer/w/demo', '/meet/demo', '/mail/login'])(
    'lets a guest reach %s without a login redirect',
    async (path) => {
      state.status = 'guest'
      const settled = await settle(path)
      expect(settled?.path).toBe(path)
      expect(settled?.meta.allowGuest).toBe(true)
    },
  )

  it('starts the installed suite in the app it was last in', () => {
    // resolve() reports the record, not where its redirect leads; ask the redirect.
    const start = router.getRoutes().find((route) => route.name === 'suite-start')!
    const redirect = start.redirect as (to: unknown) => string
    localStorage.setItem('suite:last-app', 'calendar')
    expect(redirect(router.resolve('/suite/start'))).toBe('/calendar')
    localStorage.removeItem('suite:last-app')
    expect(redirect(router.resolve('/suite/start'))).toBe('/mail')
  })
})
