import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import UnlockScreen from './UnlockScreen.vue'

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

describe('UnlockScreen', () => {
  it('puts the cursor in the password field and names nothing about the item', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp({ setup: () => () => h(UnlockScreen, { node: 'locked-folder' }) })
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
    }
    await nextTick()

    expect(document.activeElement).toBe(root.querySelector('input'))
    expect(root.textContent).not.toContain('locked-folder')
  })
})
