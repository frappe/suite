import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { buildOption } from '../../engine/chart-data'
import ChartDialog from './ChartDialog.vue'

// Plain stand-ins for the frappe-ui controls: the test drives the dialog's
// own logic, not frappe-ui's popovers.
vi.mock('frappe-ui', () => ({
  Dialog: defineComponent({
    props: { open: Boolean },
    setup:
      (props, { slots }) =>
      () =>
        props.open ? h('div', [slots.default?.(), slots.actions?.()]) : null,
  }),
  Button: defineComponent({
    props: { label: String },
    setup:
      (props, { slots }) =>
      () =>
        h('button', [props.label ?? slots.default?.()]),
  }),
  Combobox: defineComponent({
    props: { modelValue: String },
    setup: (props) => () => h('span', { 'data-combobox': props.modelValue }),
  }),
  FormControl: defineComponent({
    props: { modelValue: null, type: String, label: String, options: Array },
    emits: ['update:modelValue'],
    setup:
      (props, { emit }) =>
      () =>
        props.type === 'checkbox'
          ? h('input', {
              type: 'checkbox',
              'data-label': props.label,
              checked: !!props.modelValue,
              onChange: (e: Event) => {
                if (e.target instanceof HTMLInputElement)
                  emit('update:modelValue', e.target.checked)
              },
            })
          : h('input', { value: props.modelValue }),
  }),
}))
vi.mock('./ChartView.vue', () => ({ default: { render: () => null } }))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const FRUIT = ['Apple', 'Banana', 'Cherry', 'Date', 'Elder']
// ISSUES #153: A1:A5 = 10..50, B1:B5 = Apple..Elder.
const HEADERLESS = FRUIT.map((f, i) => [String((i + 1) * 10), f])
const WITH_HEADER = [['Score', 'Fruit'], ...HEADERLESS]

async function openDialog(displays: string[][]) {
  const open = ref(false)
  const confirmed: Array<Record<string, unknown>> = []
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () =>
      h(ChartDialog, {
        modelValue: open.value,
        'onUpdate:modelValue': (v: boolean) => (open.value = v),
        readRange: async () => ({ displays, numFmts: null }),
        usedExtent: () => null,
        currentSheet: 'Sheet1',
        initialRange: `A1:B${displays.length}`,
        onConfirm: (c: Record<string, unknown>) => confirmed.push(c),
      }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  open.value = true
  const settle = async () => {
    for (let i = 0; i < 5; i++) await nextTick()
  }
  await settle()
  const headerBox = () =>
    root.querySelector<HTMLInputElement>('input[data-label="First row is header"]')!
  return {
    headerBox,
    xAxis: () => root.querySelector('[data-combobox]')?.getAttribute('data-combobox'),
    async toggleHeader() {
      headerBox().click()
      await settle()
    },
    insert() {
      ;[...root.querySelectorAll('button')].find((b) => b.textContent === 'Insert chart')!.click()
      return confirmed.at(-1)!
    },
  }
}

describe('a new chart guesses the shape of its data', () => {
  it('reads data without a header row as data, with the text column on X', async () => {
    const d = await openDialog(HEADERLESS)
    expect(d.headerBox().checked).toBe(false)
    expect(d.xAxis()).toBe('1')
    const config = d.insert()
    expect(config).toMatchObject({ hasHeader: false, encoding: { x: 1, y: [0] } })
    // Five bars, one per fruit.
    expect(buildOption(config, HEADERLESS)).toMatchObject({
      xAxis: { data: FRUIT },
      series: [{ data: [10, 20, 30, 40, 50] }],
    })
  })

  it('reads a text first row over numbers as the header', async () => {
    const d = await openDialog(WITH_HEADER)
    expect(d.headerBox().checked).toBe(true)
    expect(d.insert()).toMatchObject({ hasHeader: true, encoding: { x: 1, y: [0] } })
  })

  it('keeps the header box as the user sets it', async () => {
    const d = await openDialog(HEADERLESS)
    await d.toggleHeader()
    expect(d.headerBox().checked).toBe(true)
    expect(d.insert()).toMatchObject({ hasHeader: true })
  })
})
