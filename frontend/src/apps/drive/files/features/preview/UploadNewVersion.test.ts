import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import UploadNewVersion from './UploadNewVersion.vue'

interface Fake {
  entry: { state: string; offline: boolean } | null
  toasts: string[]
}

const fake = vi.hoisted((): Fake => ({ entry: null, toasts: [] }))
vi.mock('frappe-ui', () => ({
  Badge: defineComponent({
    props: { label: { type: String, required: true } },
    setup: (props) => () => h('span', { 'data-badge': '' }, props.label),
  }),
}))
vi.mock('@/platform/feedback', () => ({
  confirm: async () => true,
  toast: {
    success: (message: string) => fake.toasts.push(message),
    error: (message: string) => fake.toasts.push(message),
  },
}))
vi.mock('../uploads/queue', async (importActual) => ({
  ...(await importActual<typeof import('../uploads/queue')>()),
  uploadQueue: () => ({ replaceFile: () => fake.entry }),
}))

let unmount: (() => void) | null = null
afterEach(() => {
  unmount?.()
  unmount = null
  fake.toasts = []
  document.body.innerHTML = ''
})

/** A replace that has started, with the file the user picked. */
async function replacing() {
  const entry = reactive({ state: 'uploading', offline: false })
  fake.entry = entry
  const replaced = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(UploadNewVersion, { node: 'n1', parent: 'p1', title: 'a.png', onReplaced: replaced }),
  })
  app.mount(root)
  unmount = () => app.unmount()
  const input = root.querySelector('input')!
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png')] })
  input.dispatchEvent(new Event('change'))
  const badge = () => root.querySelector('[data-badge]')?.textContent ?? null
  await vi.waitFor(() => expect(badge()).toBe('Uploading new version…'))
  return { entry, badge, replaced }
}

describe('upload a new version', () => {
  it('says what the tracker says while the connection is down', async () => {
    const { entry, badge } = await replacing()
    entry.state = 'reconnecting'
    entry.offline = true
    await nextTick()
    expect(badge()).toBe('Waiting for connection…')
    entry.offline = false
    await nextTick()
    expect(badge()).toBe('Connection lost. Retrying…')
  })

  it('hides the badge when cancelled, and still finishes after a retry', async () => {
    const { entry, badge, replaced } = await replacing()
    entry.state = 'cancelled'
    await nextTick()
    expect(badge()).toBeNull()
    expect(fake.toasts).toEqual([])

    entry.state = 'uploading'
    await nextTick()
    entry.state = 'done'
    await nextTick()
    expect(fake.toasts).toEqual(['New version uploaded'])
    expect(replaced).toHaveBeenCalledOnce()
  })
})
