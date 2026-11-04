import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import ColorPicker from './ColorPicker.vue'

// The real reka-based Popover and Tooltip: the bugs live in how they nest.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Popover')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Tooltip')),
}))

// jsdom has none; the popover's positioning watches its size.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function mountPicker() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup: () => () => h(ColorPicker, { title: 'Min colour' }) })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root.querySelector<HTMLButtonElement>('button[aria-label="Min colour"]')!
}

describe('ColorPicker', () => {
  it('opens from its own swatch button', async () => {
    const trigger = mountPicker()
    trigger.click()
    await settle()
    expect(document.querySelector('.sn-cp-pop')).not.toBeNull()
  })

  it('closes on the first Escape, with no swatch tooltip in the way', async () => {
    mountPicker().click()
    await settle()
    expect(document.querySelector('.sn-cp-sw[title="#f3f4f6"]')).not.toBeNull()

    const focused = document.activeElement ?? document.body
    focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(document.querySelector('.sn-cp-pop')).toBeNull()
  })
})
