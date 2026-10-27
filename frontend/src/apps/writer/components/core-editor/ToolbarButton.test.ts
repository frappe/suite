// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import ToolbarButton from './ToolbarButton.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Tooltip')),
}))

describe('ToolbarButton', () => {
  it('runs its click handler and names itself', () => {
    const onClick = vi.fn()
    const root = document.createElement('div')
    createApp({
      render: () => h(ToolbarButton, { icon: 'lucide-bold', label: 'Bold', onClick }),
    }).mount(root)

    const button = root.querySelector('button')!
    button.click()

    expect(onClick).toHaveBeenCalledOnce()
    expect(button.getAttribute('aria-label')).toBe('Bold')
  })
})
