import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'

import { translationPlugin } from '@/platform/translation'

import DashboardPager from './DashboardPager.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../node_modules/frappe-ui/src/components/Button')),
}))

let notify: (visible: boolean) => void = () => {}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        notify = (visible) => callback([{ isIntersecting: visible }])
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  vi.unstubAllGlobals()
})

function mount(state: { count: number; hasMore: boolean; loading: boolean }) {
  const loads = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(DashboardPager, {
        count: state.count,
        total: 100,
        hasMore: state.hasMore,
        loading: state.loading,
        onLoadMore: loads,
      }),
  })
  app.use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return loads
}

describe('Dashboard pager', () => {
  it('loads the next page when the footer scrolls into view, and again once rows arrive', async () => {
    const state = reactive({ count: 20, hasMore: true, loading: false })
    const loads = mount(state)
    await nextTick()
    expect(loads).not.toHaveBeenCalled()

    notify(true)
    await nextTick()
    expect(loads).toHaveBeenCalledTimes(1)

    state.loading = true
    await nextTick()
    state.count = 40
    state.loading = false
    await nextTick()
    expect(loads).toHaveBeenCalledTimes(2)
  })

  it('does not keep retrying a load that added no rows', async () => {
    const state = reactive({ count: 20, hasMore: true, loading: false })
    const loads = mount(state)
    await nextTick()
    notify(true)
    await nextTick()
    state.loading = true
    await nextTick()
    state.loading = false
    await nextTick()
    expect(loads).toHaveBeenCalledTimes(1)

    const buttons = [...document.querySelectorAll('button')]
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Load More'])
    buttons[0]?.click()
    await nextTick()
    expect(loads).toHaveBeenCalledTimes(2)

    notify(false)
    await nextTick()
    notify(true)
    await nextTick()
    expect(loads).toHaveBeenCalledTimes(3)
  })

  it('stops when there is nothing more to load', async () => {
    const state = reactive({ count: 20, hasMore: false, loading: false })
    const loads = mount(state)
    await nextTick()
    notify(true)
    await nextTick()
    expect(loads).not.toHaveBeenCalled()
  })
})
