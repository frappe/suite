import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { ComposeMailData } from '@/apps/mail/types'

// Whether the move about to be made loads the page afresh, as an iPhone's browser does on going from
// another app into Mail.
const pwa = vi.hoisted(() => ({ reloads: false, loadPage: vi.fn() }))
vi.mock('@/platform/pwa', () => ({
  pageLoadNeededFor: () => pwa.reloads,
  loadPage: pwa.loadPage,
}))
vi.mock('@/api', () => ({ writesSettled: async () => {} }))

const draft: ComposeMailData = {
  to: [{ email: 'dana@brightwave.example' }, { email: 'lee@northwind.example' }],
}

// A router that knows none of Mail's routes, as another app's page has before Mail first opens.
const otherAppsRouter = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/calendar')
  return router
}

/** This module as the next page load sees it: nothing in memory, the tab's storage as it was. */
const afterPageLoad = async () => {
  vi.resetModules()
  return import('./composeHandoff')
}

afterEach(() => {
  pwa.reloads = false
  pwa.loadPage.mockReset()
  sessionStorage.clear()
  vi.resetModules()
})

describe('handing a draft to the compose page', () => {
  it('opens the page for the account, from a page that has not loaded Mail', async () => {
    const { openComposePage, takePendingCompose } = await import('./composeHandoff')
    const router = await otherAppsRouter()

    await openComposePage(router, 'acc', draft)

    expect(router.currentRoute.value.path).toBe('/mail/account/acc/compose')
    expect(takePendingCompose()).toEqual(draft)
    expect(takePendingCompose()).toBeUndefined()
  })

  it('makes a move that loads the page afresh a page load, which takes the draft once', async () => {
    pwa.reloads = true
    const { openComposePage } = await import('./composeHandoff')
    const router = await otherAppsRouter()

    await openComposePage(router, 'acc', draft)

    // Nothing of the compose page mounts on the page being left: a composer there saved the draft
    // before the reload, and the page that loaded saved it again.
    expect(router.currentRoute.value.path).toBe('/calendar')
    expect(pwa.loadPage).toHaveBeenCalledExactlyOnceWith('/mail/account/acc/compose')
    expect((await afterPageLoad()).takePendingCompose()).toEqual(draft)
    // Taken, it is gone: reloading the compose page again opens an empty one.
    expect((await afterPageLoad()).takePendingCompose()).toBeUndefined()
  })

  it('leaves nothing behind for a reload after an ordinary move', async () => {
    const { openComposePage, takePendingCompose } = await import('./composeHandoff')
    await openComposePage(await otherAppsRouter(), 'acc', draft)
    takePendingCompose()

    expect((await afterPageLoad()).takePendingCompose()).toBeUndefined()
  })
})
