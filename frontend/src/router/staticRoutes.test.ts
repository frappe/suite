import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

// The router reads the onboarding state from the server boot when it is present,
// so no request is needed. The session is a stand-in whose status each test sets.
const state = vi.hoisted(() => {
  window.suite_is_onboarded = true
  window.suite_can_onboard = false
  return {
    status: 'authenticated' as 'guest' | 'authenticated',
    remembered: [] as [token: string, node: string][],
  }
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
    onLogout: () => () => {},
  }
  return { ...actual, useSession: () => session }
})

// Writer's route module warms the legacy Drive user list. The list is data,
// not routing, and its module pulls in UI this test environment cannot build.
vi.mock('@/apps/drive/legacy/sdk', () => ({ allUsers: { fetch: () => {} } }))

vi.mock('@/apps/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/drive')>()),
  rememberDriveLink: (token: string, node: string) => state.remembered.push([token, node]),
}))

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
  ])('holds %s for the %s app before any navigation', (path, appId) => {
    const resolved = router.resolve(path)
    expect(resolved.name).not.toBe('not-found')
    expect(resolved.meta.appId).toBe(appId)
  })

  it.each([
    ['/mail/login', 'mail'],
    ['/calendar', 'calendar'],
    ['/meet/room-1', 'meet'],
  ])('holds %s for the %s area before any navigation', (path, area) => {
    const resolved = router.resolve(path)
    expect(resolved.name).not.toBe('not-found')
    expect(resolved.meta.area).toBe(area)
  })

  it.each([
    ['/drive', 'drive-Home'],
    ['/sheets/new', 'sheets-editor'],
    ['/calendar', 'calendar-root-shortcut'],
    ['/meet', 'meet-home'],
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

  it.each(['suite-start', 'suite-root'])(
    'sends %s to the app it was last in before the files flip',
    (name) => {
      localStorage.setItem('suite:last-app', 'calendar')
      expect(redirectOf(router, name)).toBe('/calendar')
      localStorage.removeItem('suite:last-app')
      expect(redirectOf(router, name)).toBe('/mail')
    },
  )
})

describe('share links and shared items', () => {
  const TOKEN = 'L000000000000000000001'

  afterEach(() => {
    state.status = 'authenticated'
    state.remembered = []
    window.suite_is_onboarded = true
    window.suite_can_onboard = false
    vi.restoreAllMocks()
  })

  it.each(['guest', 'authenticated'] as const)(
    'seeds the link store and keeps no token in the URL for a %s',
    async (status) => {
      state.status = status
      const settled = await settle(`/d/doc-1?view=comments#link=${TOKEN}&x=1`)
      expect(settled?.fullPath).toBe('/d/doc-1?view=comments#x=1')
      expect(state.remembered).toEqual([[TOKEN, 'doc-1']])
    },
  )

  it('loads /l/<token> and /drive/l/<token> from the server on a click', async () => {
    await router.push('/d/doc-1')
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign })

    await router.push(`/l/${TOKEN}`)
    await router.push(`/drive/l/${TOKEN}`)

    expect(assign.mock.calls).toEqual([[`/l/${TOKEN}`], [`/drive/l/${TOKEN}`]])
    expect(router.currentRoute.value.path).toBe('/d/doc-1')
  })

  it('opens a shared item on a site that is not set up, but sends area routes to setup', async () => {
    window.suite_is_onboarded = false
    window.suite_can_onboard = true
    expect((await settle('/d/doc-2'))?.path).toBe('/d/doc-2')
    expect((await settle('/home'))?.path).toBe('/suite/setup')
  })
})

describe('the files flip', () => {
  afterEach(() => {
    delete window.suite_flip_files
    vi.resetModules()
  })

  it('mounts the Drive area under /drive and starts the suite at Home', async () => {
    window.suite_flip_files = true
    vi.resetModules()
    const { default: flipped } = await import('./index')

    expect(flipped.resolve('/drive').name).toBe('area-placeholder-files-root')
    expect(flipped.resolve('/drive/f/node-1/slug').name).toBe('area-placeholder-files-folder')
    // The old Drive pages do not mount, so an old path finds no page.
    expect(flipped.resolve('/drive/favourites').name).toBe('not-found')
    expect(flipped.resolve('/slides').meta.appId).toBe('slides')
    localStorage.setItem('suite:last-app', 'calendar')
    expect(redirectOf(flipped, 'suite-start')).toBe('/home')
    expect(redirectOf(flipped, 'suite-root')).toBe('/home')
    localStorage.removeItem('suite:last-app')
  })

  it('lets a guest open a shared folder, and nothing else in the Drive area', async () => {
    window.suite_flip_files = true
    vi.resetModules()
    const { default: flipped } = await import('./index')
    state.status = 'guest'
    const settledAt = async (path: string) => {
      let settled: RouteLocationNormalized | undefined
      const remove = flipped.beforeEach((to) => {
        settled = to
        return false
      })
      await flipped.push(path).finally(remove)
      return settled
    }

    const folder = await settledAt('/drive/f/node-1/plans')
    const home = await settledAt('/drive')

    expect([folder?.name, folder?.meta.allowGuest]).toEqual(['files-folder', true])
    expect(home).toBeUndefined()
    state.status = 'authenticated'
  })
})

// resolve() reports the record, not where its redirect leads; ask the redirect.
function redirectOf(target: typeof router, name: string): unknown {
  const record = target.getRoutes().find((route) => route.name === name)!
  const redirect = record.redirect as (to: unknown) => unknown
  return redirect(target.resolve(record.path))
}
