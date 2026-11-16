import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { translationPlugin } from '@/platform/translation'

import DeviceNotificationsRow from './DeviceNotificationsRow.vue'

vi.mock('frappe-ui', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  SettingsRow: defineComponent({
    props: { title: String, description: String },
    setup:
      (props, { slots }) =>
      () =>
        h('div', [h('p', props.title), h('p', props.description), slots.default?.()]),
  }),
  Switch: defineComponent({
    props: { modelValue: Boolean, disabled: Boolean },
    setup: (props) => () =>
      h('button', {
        role: 'switch',
        'aria-checked': String(props.modelValue),
        disabled: props.disabled,
      }),
  }),
}))

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  window.push_relay_server_url = 'https://relay.example.com'
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: {} })
})

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(DeviceNotificationsRow) })
  app.use(translationPlugin)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  return root
}

it('turns the switch off and says how to unblock when the site is blocked', () => {
  vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
  const root = mount()

  const toggle = root.querySelector<HTMLButtonElement>('[role="switch"]')!
  expect(toggle.disabled).toBe(true)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(root.textContent).toContain('Allow them in your browser settings')
})

it('offers the switch while the person has not decided', () => {
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() })
  const root = mount()

  expect(root.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(false)
  expect(root.textContent).not.toContain('blocked')
})

it('says the browser cannot show notifications when it has no Notification API', () => {
  const root = mount()

  expect(root.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
  expect(root.textContent).toContain('This browser cannot show notifications')
})
