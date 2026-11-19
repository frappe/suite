import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { defineAsyncWrapper, openLoadError } from './index'

const root = document.createElement('div')
let app: ReturnType<typeof createApp> | undefined

afterEach(() => {
  app?.unmount()
  vi.restoreAllMocks()
})

async function mountWrapped(
  load: () => Promise<ReturnType<typeof defineComponent>>,
  onFailure?: () => void,
) {
  const Wrapper = defineAsyncWrapper(load, onFailure)
  app = createApp({ render: () => h(Wrapper, null, { default: () => h('p', 'The page') }) })
  app.mount(root)
  await vi.waitFor(() => expect(root.textContent).not.toBe(''))
}

it('shows the page it wraps when its own code fails to load', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})

  await mountWrapped(() =>
    Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
  )

  expect(root.textContent).toBe('The page')
})

it('tells its caller when its own code fails to load, and not when it loads', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const onFailure = vi.fn()

  await mountWrapped(async () => defineComponent(() => () => h('p', 'Loaded')), onFailure)
  expect(onFailure).not.toHaveBeenCalled()
  app?.unmount()

  await mountWrapped(() => Promise.reject(new TypeError('Failed to fetch')), onFailure)
  expect(onFailure).toHaveBeenCalledOnce()
})

it('wraps the page in what it loads', async () => {
  const Frame = defineComponent(
    (_props, { slots }) =>
      () =>
        h('main', ['Frame: ', slots.default?.()]),
  )

  await mountWrapped(async () => Frame)

  expect(root.querySelector('main')?.textContent).toBe('Frame: The page')
})

describe('openLoadError', () => {
  const Page = defineComponent(() => () => h('p', 'A page'))
  const options = { errorRoute: 'load-error' }

  function makeRouter() {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/files/:id', component: Page },
        { path: '/load-error', name: 'load-error', component: Page },
      ],
    })
  }

  async function settled(router: ReturnType<typeof makeRouter>) {
    await vi.waitFor(() => expect(router.currentRoute.value.matched.length).toBeGreaterThan(0))
    return router.currentRoute.value.fullPath
  }

  it('opens the error route with the page the person was on', async () => {
    const router = makeRouter()
    await router.push('/files/7?tab=2')

    openLoadError(router, options)

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('load-error'))
    expect(router.currentRoute.value.query.redirect).toBe('/files/7?tab=2')
  })

  it('leaves the error route as it is', async () => {
    const router = makeRouter()
    await router.push('/load-error?redirect=/files/7')

    openLoadError(router, options)

    expect(await settled(router)).toBe('/load-error?redirect=/files/7')
  })

  it('does nothing before the first navigation has settled', async () => {
    const router = makeRouter()

    openLoadError(router, options)
    // Long enough for a navigation it started to finish.
    await new Promise((resolve) => setTimeout(resolve))

    expect(router.currentRoute.value.name).toBeUndefined()
  })
})
