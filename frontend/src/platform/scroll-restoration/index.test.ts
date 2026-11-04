import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { createRouter, createWebHistory, type Router } from 'vue-router'

import { installScrollRestoration, useRestoredScroll } from './index'

const shell = vi.hoisted(() => ({ scroller: null as null | { value: HTMLElement | null } }))
vi.mock('frappe-ui', async () => {
  const { ref } = await import('vue')
  return { shellScrollContainer: (shell.scroller = ref<HTMLElement | null>(null)) }
})

/** A scroll box that clamps like a browser: it cannot scroll past its content. */
function scrollBox(contentHeight: number) {
  const el = document.createElement('div')
  const box = { el, contentHeight, clientHeight: 500 }
  let top = 0
  Object.defineProperties(el, {
    clientHeight: { get: () => box.clientHeight },
    scrollHeight: { get: () => Math.max(box.contentHeight, box.clientHeight) },
    scrollTop: {
      get: () => Math.min(top, el.scrollHeight - el.clientHeight),
      set: (value: number) => {
        top = Math.max(0, Math.min(value, el.scrollHeight - el.clientHeight))
      },
    },
  })
  return box
}

const Page = { render: () => null }
let router: Router
let uninstall: () => void

beforeEach(async () => {
  router = createRouter({
    history: createWebHistory('/'),
    routes: [
      { path: '/drive', component: Page },
      { path: '/drive/f/:node', component: Page },
      { path: '/home', component: Page, meta: { scroll: 'content' } },
    ],
  })
  uninstall = installScrollRestoration(router)
  await router.push('/drive')
})

afterEach(() => {
  uninstall()
  shell.scroller!.value = null
})

async function back() {
  const done = new Promise((resolve) => router.afterEach(() => resolve(undefined)))
  router.back()
  await done
}
async function forward() {
  const done = new Promise((resolve) => router.afterEach(() => resolve(undefined)))
  router.forward()
  await done
}
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

describe('scroll restoration', () => {
  it('restores each history entry on Back and Forward, and starts a new visit at the top', async () => {
    const box = scrollBox(3000)
    shell.scroller!.value = box.el

    box.el.scrollTop = 150
    await router.push('/drive/f/reports')
    await frame()
    expect(box.el.scrollTop).toBe(0)

    box.el.scrollTop = 600
    await back()
    await frame()
    expect(box.el.scrollTop).toBe(150)

    await forward()
    await frame()
    expect(box.el.scrollTop).toBe(600)

    // The same folder, reached by a new click, is a new entry with its own position.
    await back()
    await router.push('/drive/f/reports')
    await frame()
    expect(box.el.scrollTop).toBe(0)
  })

  it('keeps the position when only the query changes', async () => {
    const box = scrollBox(3000)
    shell.scroller!.value = box.el

    box.el.scrollTop = 420
    await router.replace({ query: { sort: 'modified' } })
    await router.push({ query: { sort: 'title', view: 'grid' } })
    await frame()
    expect(box.el.scrollTop).toBe(420)
  })

  it('waits for content that arrives after the page renders, without a stop on the way', async () => {
    const box = scrollBox(3000)
    shell.scroller!.value = box.el

    box.el.scrollTop = 900
    await router.push('/drive/f/reports')
    box.contentHeight = 200 // the listing shows a loading state
    await back()

    const seen: number[] = []
    for (let i = 0; i < 3; i++) {
      await frame()
      seen.push(box.el.scrollTop)
    }
    box.contentHeight = 3000 // the rows arrive
    await frame()
    await frame()
    seen.push(box.el.scrollTop)
    expect(seen).toEqual([0, 0, 0, 900])
  })

  it('leaves the page alone once the person scrolls during a pending restore', async () => {
    const box = scrollBox(3000)
    shell.scroller!.value = box.el

    box.el.scrollTop = 900
    await router.push('/drive/f/reports')
    box.contentHeight = 200
    await back()
    await frame()

    window.dispatchEvent(new WheelEvent('wheel'))
    box.contentHeight = 3000
    await frame()
    await frame()
    expect(box.el.scrollTop).toBe(0)
  })

  it('restores the scroller a content-scrolling page names', async () => {
    const shellBox = scrollBox(3000)
    shell.scroller!.value = shellBox.el
    const pageBox = scrollBox(3000)
    const element = ref<HTMLElement | null>(null)

    await router.push('/home')
    const page = effectScope()
    page.run(() => useRestoredScroll(element))
    element.value = pageBox.el
    pageBox.el.scrollTop = 700

    await router.push('/drive')
    page.stop() // Home unmounts
    await frame()
    expect(shellBox.el.scrollTop).toBe(0)

    // Home mounts again with a fresh scroller.
    const remounted = scrollBox(3000)
    await back()
    const again = effectScope()
    again.run(() => useRestoredScroll(() => remounted.el))
    await frame()
    expect(remounted.el.scrollTop).toBe(700)
    again.stop()
  })
})
