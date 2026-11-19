import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, reactive, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { followRouteAccount } from '@/apps/calendar/router'
import { userStore } from '@/apps/calendar/stores/user'

// Two calendar accounts the reader works in. Nothing else is asked of the server here.
vi.mock('@/api', async (original) => {
  const actual = await original<typeof import('@/api')>()
  return {
    ...actual,
    useQuery: (query: unknown) =>
      reactive({
        data:
          query === actual.api.mail.account.get
            ? {
                accounts: [
                  { id: 'mine', in_calendar: 1 },
                  { id: 'team', in_calendar: 1 },
                ],
              }
            : undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
      }),
  }
})

let app: App | undefined
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})
afterEach(() => app?.unmount())

// The calendar's month route under a layout that follows the route's account, as
// CalendarLayout does.
const calendarAt = async (path: string) => {
  const page = { render: () => null }
  const layout = defineComponent({
    setup: () => {
      followRouteAccount()
      return () => h(RouterView)
    },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/calendar',
        component: layout,
        children: [{ path: 'account/:accountId/month', name: 'calendar-month', component: page }],
      },
    ],
  })
  app = createApp({ render: () => h(RouterView) })
  app.use(router)
  await router.push(path)
  app.mount(document.createElement('div'))
  await router.isReady()
  return router
}

describe('switching accounts inside Calendar', () => {
  it('moves the calendar to the account the route now names', async () => {
    const router = await calendarAt('/calendar/account/mine/month')
    const store = userStore()
    store.accountId = 'mine'

    await router.push({ name: 'calendar-month', params: { accountId: 'team' } })

    expect(store.accountId).toBe('team')
  })
})
