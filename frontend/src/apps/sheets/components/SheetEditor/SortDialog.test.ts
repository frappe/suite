import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import SortDialog from './SortDialog.vue'

vi.mock('frappe-ui', () => ({
  Dialog: {
    props: ['open'],
    setup: (props: { open: boolean }, { slots }: { slots: Record<string, () => unknown> }) =>
      () =>
        props.open ? h('div', [slots.default?.(), slots.actions?.()]) : null,
  },
  FormControl: { render: () => h('div') },
  Button: {
    inheritAttrs: false,
    props: ['label'],
    setup: (props: { label: string }, { attrs }: { attrs: Record<string, unknown> }) => () =>
      h('button', { onClick: attrs.onClick }, props.label),
  },
  Checkbox: {
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
    setup(
      props: { modelValue: boolean; label: string },
      { emit }: { emit: (event: string, value: boolean) => void },
    ) {
      return () =>
        h('label', [
          h('input', {
            type: 'checkbox',
            checked: props.modelValue,
            onChange: () => emit('update:modelValue', !props.modelValue),
          }),
          props.label,
        ])
    },
  },
}))

const RECT = { r0: 4, c0: 2, r1: 7, c1: 3 }
let root: HTMLElement
let unmount: () => void
afterEach(() => unmount())

async function openDialog(guess: { header: boolean; totals: boolean }) {
  const apply = vi.fn()
  const dialog = ref<InstanceType<typeof SortDialog> | null>(null)
  root = document.createElement('div')
  const app = createApp({ render: () => h(SortDialog, { ref: dialog, onApply: apply }) })
  app.mount(root)
  unmount = () => app.unmount()
  dialog.value?.open({ rect: RECT, col: 3, ...guess })
  await nextTick()
  return apply
}

const boxLabelled = (label: string) =>
  [...root.querySelectorAll('label')]
    .find((box) => box.textContent === label)
    ?.querySelector('input')
const sortButton = () =>
  [...root.querySelectorAll('button')].find((button) => button.textContent === 'Sort')

describe('the sort dialog', () => {
  it('starts from the guesses and sorts with what is ticked', async () => {
    const apply = await openDialog({ header: true, totals: true })
    expect(boxLabelled('Data has a header row')?.checked).toBe(true)
    expect(boxLabelled('Leave the last row of totals out')?.checked).toBe(true)

    boxLabelled('Data has a header row')?.dispatchEvent(new Event('change'))
    await nextTick()
    sortButton()?.click()

    expect(apply).toHaveBeenCalledWith({
      rect: RECT,
      col: 3,
      dir: 'asc',
      header: false,
      totals: true,
    })
  })

  it('does not ask about totals when there are none', async () => {
    await openDialog({ header: false, totals: false })

    expect(boxLabelled('Data has a header row')?.checked).toBe(false)
    expect(boxLabelled('Leave the last row of totals out')).toBeUndefined()
  })
})
