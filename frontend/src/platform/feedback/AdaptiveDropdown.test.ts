import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import AdaptiveDropdown from './AdaptiveDropdown.vue'

// A phone: the menu is a sheet, here a plain box.
vi.mock('@/composables/useScreenSize', async () => {
  const { ref } = await import('vue')
  return { useScreenSize: () => ({ isMobile: ref(true) }) }
})
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    BottomSheet: defineComponent({
      props: { open: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('div', { 'data-sheet': '' }, slots.default?.()) : null,
    }),
    Switch: { render: () => null },
  }
})
vi.mock('@/platform/feedback', () => ({ Dropdown: { render: () => null } }))

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

type Options = InstanceType<typeof AdaptiveDropdown>['$props']['options']

function lines(options: Options) {
  const root = document.body.appendChild(document.createElement('div'))
  const app = createApp(
    defineComponent({ setup: () => () => h(AdaptiveDropdown, { options, open: true }) }),
  )
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  return root.querySelectorAll('[data-sheet] .border-t').length
}

const row = (label: string) => ({ label, onClick: () => {} })

describe('a menu on a phone', () => {
  it('draws no line between two rows, though the second is a group of its own', () => {
    expect(lines([row('Edit draft'), { group: '', options: [row('Discard')] }])).toBe(0)
  })

  it('keeps the line between groups once there are more rows to sort', () => {
    expect(lines([row('Reply'), row('Forward'), { group: '', options: [row('Delete')] }])).toBe(1)
  })
})
