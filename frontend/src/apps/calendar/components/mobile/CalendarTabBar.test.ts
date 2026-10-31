import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import CalendarTabBar from '@/apps/calendar/components/mobile/CalendarTabBar.vue'

const calls = vi.hoisted(() => ({ sheets: [] as string[] }))

// Unit tests alias frappe-ui to a stub. The bar and its items are the real
// components here, so a wrong prop name fails the test.
vi.mock('frappe-ui', async (original) => {
  const { defineComponent, h } = await import('vue')
  return {
    ...(await original<object>()),
    MobileNav: (
      await import('../../../../../../node_modules/frappe-ui/src/components/MobileNav/MobileNav.vue')
    ).default,
    MobileNavItem: (
      await import('../../../../../../node_modules/frappe-ui/src/components/MobileNav/MobileNavItem.vue')
    ).default,
    Avatar: defineComponent({ setup: () => () => h('span') }),
  }
})
vi.mock('@/apps/calendar/stores/user', () => ({ userStore: () => ({ accountId: 'a' }) }))
vi.mock('@/platform/area-sidebar', () => ({
  openAreaSidebar: (area: string) => calls.sheets.push(area),
}))
vi.mock('@/platform/session', async (original) => {
  const { ref } = await import('vue')
  const session = {
    status: ref('authenticated'),
    user: ref({ id: 'a@suite.test', fullName: 'Ada', avatar: null }),
    onLogout: () => () => {},
  }
  return { ...(await original<object>()), useSession: () => session }
})

const translate = (text: string) => text
vi.stubGlobal('__', translate)

let cleanup: (() => void) | undefined
beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup?.()
  calls.sheets = []
})

async function mountAt(path: string) {
  const page = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['day', 'week', 'month', 'agenda', 'search', 'profile'].map((view) => ({
      path: `/calendar/account/:accountId/${view}`,
      name: `calendar-${view}`,
      component: page,
    })),
  })
  await router.push(path)
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ setup: () => () => h(CalendarTabBar) })
  app.config.globalProperties.__ = translate
  app.use(router)
  app.mount(root)
  await router.isReady()
  await nextTick()
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const items = () =>
    [...root.querySelectorAll<HTMLElement>('[data-slot="mobile-nav-item"]')].map((item) =>
      item.getAttribute('aria-label'),
    )
  const item = (label: string) =>
    root.querySelector<HTMLElement>(`[data-slot="mobile-nav-item"][aria-label="${label}"]`)!
  return { router, items, item }
}

describe("Calendar's bottom bar", () => {
  it('holds the view you are on, Search and your profile, and no other app', async () => {
    const { items } = await mountAt('/calendar/account/a/week')
    expect(items()).toEqual(['Week', 'Search', 'Profile'])
  })

  it('opens the views and calendars from the view you are on', async () => {
    const { item, router } = await mountAt('/calendar/account/a/month')
    item('Month').click()
    expect(calls.sheets).toEqual(['calendar'])
    expect(router.currentRoute.value.fullPath).toBe('/calendar/account/a/month')
  })

  it('opens Search and Profile', async () => {
    const { item, router } = await mountAt('/calendar/account/a/agenda')
    item('Search').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/calendar/account/a/search'),
    )
    item('Profile').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/calendar/account/a/profile'),
    )
  })

  it('goes back to the view the calendar was left in, from Profile', async () => {
    localStorage.setItem('calendar-view', 'calendar-day')
    const { items, item, router } = await mountAt('/calendar/account/a/profile')
    expect(items()[0]).toBe('Day')
    item('Day').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/calendar/account/a/day'),
    )
    expect(calls.sheets).toEqual([])
  })

  it('goes back to the agenda from Search when no view is remembered', async () => {
    const { items, item, router } = await mountAt('/calendar/account/a/search')
    expect(items()[0]).toBe('Agenda')
    item('Agenda').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/calendar/account/a/agenda'),
    )
  })
})
