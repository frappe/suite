import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { ComposeMailData } from '@/apps/mail/types'

// Whether the move about to be made loads the page afresh, as an iPhone's browser does on going from
// another app into Mail.
const pwa = vi.hoisted(() => ({ reloads: false }))
vi.mock('@/platform/pwa', () => ({ pageLoadNeededFor: () => pwa.reloads }))

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

  it('still carries the draft when the move loads the page afresh', async () => {
    pwa.reloads = true
    const { openComposePage, takePendingCompose } = await import('./composeHandoff')
    await openComposePage(await otherAppsRouter(), 'acc', draft)
    // The page being left mounts the composer before it reloads.
    takePendingCompose()

    const next = await afterPageLoad()

    expect(next.takePendingCompose()).toEqual(draft)
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
