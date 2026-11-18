import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import UnlockScreen from './UnlockScreen.vue'

const unlock = vi.hoisted(() => ({ outcome: { status: 'wrong-password' as const } }))
vi.mock('@/apps/drive/client/unlock', () => ({ unlockNode: async () => unlock.outcome }))

// A password field and a submit button that behave as the real ones do for this form.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h: render } = await import('vue')
  return {
    FormControl: defineComponent({
      inheritAttrs: false,
      props: { modelValue: String, disabled: Boolean },
      emits: ['update:modelValue'],
      setup:
        (props, { attrs, emit }) =>
        () =>
          render('input', {
            ...attrs,
            value: props.modelValue,
            disabled: props.disabled,
            onInput: (event: Event) =>
              event.target instanceof HTMLInputElement &&
              emit('update:modelValue', event.target.value),
          }),
    }),
    Button: defineComponent({
      props: { label: String, disabled: Boolean },
      setup: (props) => () =>
        render('button', { type: 'submit', disabled: props.disabled }, props.label),
    }),
  }
})

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

  it('puts the cursor back in the emptied password field after a wrong password', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp({ setup: () => () => h(UnlockScreen, { node: 'locked-folder' }) })
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
    }
    await nextTick()
    const input = root.querySelector('input')
    if (!input) throw new Error('No password field')

    input.value = 'guess'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    // Pressing Open moves focus to the button.
    root.querySelector('button')?.focus()
    root.querySelector('form')?.requestSubmit()

    await vi.waitFor(() => expect(root.textContent).toContain('Wrong password'))
    await vi.waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.value).toBe('')
  })
})
