import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import AdaptiveDialog from './AdaptiveDialog.vue'

// A phone: the dialog is a sheet, here a plain box with its title.
vi.mock('@/composables/useScreenSize', async () => {
  const { ref } = await import('vue')
  return { useScreenSize: () => ({ isMobile: ref(true) }) }
})
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    BottomSheet: defineComponent({
      props: { open: Boolean, title: { type: String, default: '' } },
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('div', { 'data-sheet': props.title }, slots.default?.()) : null,
    }),
    Button: defineComponent({
      props: { label: { type: String, default: '' } },
      emits: ['click'],
      setup:
        (props, { emit }) =>
        () =>
          h('button', { onClick: () => emit('click') }, props.label),
    }),
    Dialog: { render: () => null },
  }
})

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

function show(render: (open: { value: boolean }) => ReturnType<typeof h>) {
  const open = ref(true)
  const root = document.body.appendChild(document.createElement('div'))
  const app = createApp(defineComponent({ setup: () => () => render(open) }))
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  const buttons = () => [...root.querySelectorAll('button')].map((button) => button.textContent)
  const press = (label: string) =>
    [...root.querySelectorAll('button')].find((button) => button.textContent === label)!.click()
  return { open, root, buttons, press }
}

describe('a dialog on a phone', () => {
  it('asks a question as an action sheet: its action, then Cancel, which closes it', async () => {
    const deleted = vi.fn()
    const { open, buttons, press } = show((open) =>
      h(AdaptiveDialog, {
        open: open.value,
        'onUpdate:open': (value: boolean) => (open.value = value),
        title: 'Delete Work?',
        message: 'Its mail goes too.',
        actions: [{ label: 'Delete', theme: 'red', onClick: deleted }],
      }),
    )

    expect(buttons()).toEqual(['Delete', 'Cancel'])
    press('Cancel')
    await nextTick()
    expect([open.value, deleted.mock.calls.length]).toEqual([false, 0])
  })

  it('ends a question with its own Cancel, once, and runs it', async () => {
    const cancelled = vi.fn()
    const { buttons, press } = show((open) =>
      h(AdaptiveDialog, {
        open: open.value,
        title: 'Turn on auto-reply?',
        message: 'Sorting stops.',
        actions: [
          { label: 'Cancel', onClick: cancelled },
          { label: 'Turn on', onClick: vi.fn() },
        ],
      }),
    )

    expect(buttons()).toEqual(['Turn on', 'Cancel'])
    press('Cancel')
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
  })

  it('runs an action with the way to close it, and offers no Cancel beside a form', async () => {
    const { open, buttons, press } = show((open) =>
      h(
        AdaptiveDialog,
        {
          open: open.value,
          'onUpdate:open': (value: boolean) => (open.value = value),
          title: 'Screen a sender',
          actions: [{ label: 'Add', onClick: ({ close }: { close: () => void }) => close() }],
        },
        { default: () => h('input') },
      ),
    )

    expect(buttons()).toEqual(['Add'])
    press('Add')
    await vi.waitFor(() => expect(open.value).toBe(false))
  })
})
