import { createApp, defineComponent, h } from 'vue'
import { expect, it, vi } from 'vitest'

vi.mock('frappe-ui', () => ({
  Alert: defineComponent({
    props: ['title'],
    setup(props) { return () => h('div', props.title) },
  }),
  Dialog: defineComponent({ setup: (_props, { slots }) => () => h('div', slots.default?.()) }),
}))

import BatchOutcome from './BatchOutcome.vue'
import { batchResultText } from './batchResult'

it('renders mixed batch outcomes', () => {
  const result = { ok: Array(14).fill('ok'), failed: Array(4).fill({ node: 'x', type: 'DriveConflict', message: 'No' }) }
  expect(batchResultText(result, 'moved')).toBe('14 moved · 4 failed')
  const root = document.createElement('div')
  const app = createApp(BatchOutcome, { result, verb: 'moved' })
  app.mount(root)
  expect(root.textContent).toContain('14 moved · 4 failed')
  app.unmount()
})
