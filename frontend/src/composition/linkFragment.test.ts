import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

import { takeLinkFragment } from './linkFragment'

const TOKEN = 'L000000000000000000001'
const Page = defineComponent({ setup: () => () => h('div') })

/** A router with the two node routes a link opens, and the guard that reads the fragment. */
function linkRouter(remember: (token: string, node: string) => void) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/drive/f/:node/:slug?', component: Page },
      { path: '/d/:node/:slug?', component: Page },
      { path: '/home', component: Page },
    ],
  })
  router.beforeEach((to) => takeLinkFragment(to, remember) ?? true)
  return router
}

describe('the #link= fragment', () => {
  it('seeds the link store for the node before the route resolves, and leaves no token in the URL', async () => {
    const seeded: Array<[string, string]> = []
    const router = linkRouter((token, node) => seeded.push([token, node]))
    const resolvedWithSeed = vi.fn()
    router.beforeResolve(() => resolvedWithSeed(seeded.length))

    await router.push(`/drive/f/folder-1#link=${TOKEN}`)
    const folder = router.currentRoute.value.fullPath
    await router.push(`/d/doc-1/q3-plan?view=grid#link=${TOKEN}`)

    expect(seeded).toEqual([[TOKEN, 'folder-1'], [TOKEN, 'doc-1']])
    expect(resolvedWithSeed.mock.calls.every(([count]) => count > 0)).toBe(true)
    expect([folder, router.currentRoute.value.fullPath]).toEqual(['/drive/f/folder-1', '/d/doc-1/q3-plan?view=grid'])
  })

  it('leaves other fragments alone and strips a link fragment on a route with no node', async () => {
    const remember = vi.fn()
    const router = linkRouter(remember)

    await router.push('/d/doc-1#comment-4')
    const other = router.currentRoute.value.fullPath
    await router.push(`/home#link=${TOKEN}`)

    expect(other).toBe('/d/doc-1#comment-4')
    expect(router.currentRoute.value.fullPath).toBe('/home')
    expect(remember).not.toHaveBeenCalled()
  })
})
