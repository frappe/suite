import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import CalendarModal from './CalendarModal.vue'

const state = vi.hoisted(() => ({ save: vi.fn(), failureToast: vi.fn() }))
vi.mock('@/apps/calendar/stores/user', () => ({
  userStore: () => ({ accountId: 'personal', calendars: { data: [], refetch: async () => {} } }),
}))
vi.mock('@/apps/calendar/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/calendar/utils/color', () => ({ eventColor: () => 'green' }))
vi.mock('@/platform/feedback', () => ({
  failureLine: (error: Error | null) => error?.message,
}))
vi.mock('@/api', async () => {
  const { fakeMutation } = await import('@/platform/testing/mutations')
  return {
    api: {
      calendar: { calendars: { create: { id: 'create_calendar' }, update: { id: 'update' } } },
    },
    useMutation: (reference: { id: string }, options?: { silent?: boolean }) =>
      fakeMutation((input) => state.save(reference.id, input), state.failureToast, options),
  }
})
// Plain stand-ins: a field is a native input named by its label, with what is wrong with it said
// under it, and the dialog's own buttons follow what is in it
vi.mock('frappe-ui', () => ({
  Dialog: defineComponent({
    props: {
      open: Boolean,
      actions: { type: Array<{ label: string; onClick: () => void }>, default: () => [] },
    },
    setup(props, { slots }) {
      return () => {
        if (!props.open) {
          return null
        }

        const buttons = props.actions.map((action) =>
          h('button', { onClick: action.onClick }, action.label),
        )
        return h('dialog', [slots.default?.(), buttons])
      }
    },
  }),
  FormControl: defineComponent({
    props: {
      modelValue: { type: String, default: '' },
      label: { type: String, default: '' },
      error: { type: String, default: undefined },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () => [
        h('input', {
          'aria-label': props.label,
          value: props.modelValue,
          onInput: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
        }),
        props.error && h('p', { role: 'alert' }, props.error),
      ]
    },
  }),
}))

let app: ReturnType<typeof createApp>
let root: HTMLElement
const show = ref(false)
/** Opens the form for a new calendar, as New on the Calendars page does. */
async function open() {
  show.value = true
  await nextTick()
}

beforeEach(async () => {
  window.__ = (text: string) => text
  state.save.mockReset().mockResolvedValue(undefined)
  state.failureToast.mockReset()
  show.value = false
  root = document.createElement('div')
  app = createApp({
    setup: () => () =>
      h(CalendarModal, {
        modelValue: show.value,
        'onUpdate:modelValue': (value: boolean) => {
          show.value = value
        },
      }),
  })
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
  await open()
})
afterEach(() => app.unmount())

/** What is said under the Name field, when something is. */
function underName() {
  const said = root.querySelector('input[aria-label="Name"]')?.nextElementSibling
  if (said?.getAttribute('role') !== 'alert') {
    return undefined
  }

  return said.textContent
}

async function saveAs(name: string) {
  const field = requireTestElement(root.querySelector('input[aria-label="Name"]'), HTMLInputElement)
  field.value = name
  field.dispatchEvent(new Event('input'))
  await nextTick()
  const save = Array.from(root.querySelectorAll('button')).find(
    (button) => button.textContent === 'Save',
  )
  requireTestElement(save, HTMLButtonElement).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

it('says under the name why a calendar was refused, in place of a toast', async () => {
  state.save.mockRejectedValue(new Error('You already have a calendar named Team'))
  await saveAs('Team')
  expect(underName()).toBe('You already have a calendar named Team')
  expect(state.failureToast).not.toHaveBeenCalled()
  expect(show.value).toBe(true)
})
it('opens again without what the last visit was refused', async () => {
  state.save.mockRejectedValue(new Error('You already have a calendar named Team'))
  await saveAs('Team')
  show.value = false
  await nextTick()
  await open()
  expect(underName()).toBeUndefined()
})
