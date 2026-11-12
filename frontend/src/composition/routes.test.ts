import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { DOCUMENT_VIEW_SEGMENTS, driveNodeRoute } from '@/apps/drive'
import { canonicalRoutes, routes } from '@/composition/routes'
import { installLoadFailureRecovery } from '@/platform/load-failure'

describe('canonical route metadata', () => {
  it('declares a frame and scroll owner on every canonical route', () => {
    for (const route of canonicalRoutes) {
      expect(route.meta?.frame, String(route.path)).toMatch(/^(shell|none)$/)
      expect(route.meta?.scroll, String(route.path)).toMatch(/^(shell|content)$/)
    }
  })

  it('names the recovery copies page before its routes load', () => {
    const recovery = canonicalRoutes.find((route) => route.path === '/drive/recovery')
    expect(recovery?.meta?.title).toBe('Recovery copies')
  })

  it.each(['mail', 'calendar', 'people', 'meet'])('renders %s in the shell', (area) => {
    expect(canonicalRoutes.find((route) => route.meta?.area === area)?.meta?.frame).toBe('shell')
  })
})

describe('document routes', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: canonicalRoutes })

  it('opens the slideshow at /present and the document at any other slug', () => {
    expect(router.resolve('/d/n1/present').name).toBe('slides-slideshow')
    expect(router.resolve('/d/n1/q3-review').name).toBe('document-host')
    expect(router.resolve('/d/n1').name).toBe('document-host')
  })

  it('admits guests to a slideshow', () => {
    expect(router.resolve('/d/n1/present').meta.allowGuest).toBe(true)
  })

  it.each(['Present', 'PRESENT!'])('opens a document titled %s in the document', (title) => {
    expect(router.resolve(driveNodeRoute('n1', title)).name).toBe('document-host')
  })

  it('keeps the slug of a title that only starts with a view', () => {
    expect(router.resolve(driveNodeRoute('n1', 'Present plan')).path).toBe('/d/n1/present-plan')
  })

  it('reserves every view segment under a document', () => {
    const document = canonicalRoutes.find((route) => route.path === '/d/:node')
    const views = document?.children
      ?.map((child) => child.path)
      .filter((path) => !path.startsWith(':'))
    expect(views?.length).toBeGreaterThan(0)
    expect(DOCUMENT_VIEW_SEGMENTS).toEqual(expect.arrayContaining(views ?? []))
  })
})

describe('a page whose code fails to load', () => {
  const assign = vi.fn()
  let cleanup: (() => void) | undefined

  afterEach(() => {
    cleanup?.()
    sessionStorage.clear()
    assign.mockReset()
    vi.unstubAllGlobals()
  })

  /** The suite's routes plus pages whose imports fail the way a browser reports it. */
  function mountRouter(failure: Error) {
    vi.stubGlobal('location', { assign })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/broken', component: () => Promise.reject(failure) },
        { path: '/working', component: { render: () => h('p', 'Working page') } },
        ...routes,
      ],
    })
    installLoadFailureRecovery(router, { errorRoute: 'app-load-error' })
    const root = document.createElement('div')
    const app = createApp({ render: () => h(RouterView) })
    app.use(router)
    app.mount(root)
    cleanup = () => app.unmount()
    return { router, root }
  }

  async function open(router: ReturnType<typeof mountRouter>['router'], path: string) {
    await router.push(path).catch(() => {})
    await vi.waitFor(() => expect(router.currentRoute.value.matched.length).toBeGreaterThan(0))
    await nextTick()
  }

  it('says so and offers a reload of the page it was opening', async () => {
    const { router, root } = mountRouter(new TypeError('Failed to fetch'))
    await open(router, '/broken?tab=2')

    expect(router.currentRoute.value.name).toBe('app-load-error')
    expect(root.textContent).toContain('This page did not load')
    const reload = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Reload')
    reload?.click()
    expect(assign).toHaveBeenCalledWith('/broken?tab=2')
  })

  it('reloads once by itself when a deploy removed its chunk, then says so', async () => {
    const stale = new TypeError(
      'Failed to fetch dynamically imported module: https://suite.test/assets/Page-1a2b.js',
    )
    const { router, root } = mountRouter(stale)

    await router.push('/broken').catch(() => {})
    expect(assign).toHaveBeenCalledExactlyOnceWith('/broken')

    // The reloaded page still cannot load it: no second reload.
    await open(router, '/broken')
    expect(assign).toHaveBeenCalledOnce()
    expect(root.textContent).toContain('This page did not load')
  })

  it('reloads by itself again after a page has loaded since', async () => {
    const stale = new TypeError('Importing a module script failed.')
    const { router } = mountRouter(stale)

    await router.push('/broken').catch(() => {})
    await open(router, '/working')
    await router.push('/broken').catch(() => {})

    expect(assign).toHaveBeenCalledTimes(2)
  })
})
