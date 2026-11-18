import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { defineAsyncWrapper } from './index'

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
