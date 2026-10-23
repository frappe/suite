import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import NewMeetingMenu from './NewMeetingMenu.vue'

vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    props: ['label', 'disabled'],
    setup:
      (props, { attrs }) =>
      () =>
        h('button', { ...attrs, disabled: props.disabled }, props.label),
  }),
  Dropdown: defineComponent({
    props: ['options', 'button'],
    setup:
      (props, { attrs }) =>
      () =>
        h('div', [
          h('button', { ...attrs, disabled: props.button.disabled }, 'Chevron'),
          ...props.options.map(
            (option: { label: string; disabled?: boolean; onClick: () => void }) =>
              h('button', { disabled: option.disabled, onClick: option.onClick }, option.label),
          ),
        ]),
  }),
}))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

describe('New meeting split button', () => {
  it('starts an open meeting from the primary button and offers only the alternatives in the menu', async () => {
    const instant = vi.fn()
    const restricted = vi.fn()
    const schedule = vi.fn()
    const root = document.createElement('div')
    const app = createApp(NewMeetingMenu, {
      onInstant: instant,
      onRestricted: restricted,
      onSchedule: schedule,
    })
    app.mount(root)
    cleanup = () => app.unmount()

    const buttons = root.querySelectorAll('button')
    expect([...buttons].map((button) => button.textContent)).toEqual([
      'New meeting',
      'Chevron',
      'Create a restricted meeting',
      'Schedule a meeting',
    ])
    buttons[0].click()
    await nextTick()
    expect(instant).toHaveBeenCalledOnce()
    expect(restricted).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
    buttons[2].click()
    buttons[3].click()
    expect(restricted).toHaveBeenCalledOnce()
    expect(schedule).toHaveBeenCalledOnce()
  })

  it('disables both halves while creating a meeting', () => {
    const root = document.createElement('div')
    const app = createApp(NewMeetingMenu, { loading: true })
    app.mount(root)
    cleanup = () => app.unmount()
    const buttons = root.querySelectorAll('button')
    expect(buttons[0].disabled).toBe(true)
    expect(buttons[1].disabled).toBe(true)
  })
})
