import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import DmarcBreakdownRows from './DmarcBreakdownRows.vue'
import TlsBreakdownRows from './TlsBreakdownRows.vue'

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

describe.each([
  ['DMARC', DmarcBreakdownRows],
  ['TLS', TlsBreakdownRows],
] as const)('%s report breakdown loading', (_, component) => {
  it('waits for a completed read before reporting that no mail was reported', async () => {
    const loading = ref(true)
    const root = document.createElement('div')
    const app = createApp({
      render: () =>
        h(component, {
          rows: [],
          labelKey: 'reporter',
          empty: 'No mail was reported',
          loading: loading.value,
        }),
    })
    app.mount(root)
    cleanup = () => app.unmount()
    expect(root.textContent).not.toContain('No mail was reported')
    expect(root.querySelector('[aria-hidden="true"]')).not.toBeNull()

    loading.value = false
    await nextTick()
    expect(root.textContent).toContain('No mail was reported')
  })
})
