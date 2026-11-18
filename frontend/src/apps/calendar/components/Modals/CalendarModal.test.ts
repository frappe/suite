import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'

import type { CalendarRow } from '@/apps/calendar/utils/calendars'
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
      actions: {
        type: Array<{ label: string; disabled?: boolean; onClick: () => void }>,
        default: () => [],
      },
    },
    setup(props, { slots }) {
      return () => {
        if (!props.open) {
          return null
        }

        const buttons = props.actions.map((action) =>
          h('button', { disabled: action.disabled, onClick: action.onClick }, action.label),
        )
        return h('dialog', [slots.default?.(), buttons])
      }
    },
  }),
  FormControl: defineComponent({
    props: {
      modelValue: { type: [String, Boolean], default: '' },
      type: { type: String, default: 'text' },
      label: { type: String, default: '' },
      error: { type: String, default: undefined },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      // A tick box hands back that it was ticked, and any other field what was typed
      function field() {
        if (props.type === 'checkbox') {
          return h('input', {
            type: 'checkbox',
            'aria-label': props.label,
            onChange: () => emit('update:modelValue', true),
          })
        }

        return h('input', {
          'aria-label': props.label,
          value: props.modelValue,
          onInput: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
        })
      }

      return () => [field(), props.error && h('p', { role: 'alert' }, props.error)]
    },
  }),
}))

let app: ReturnType<typeof createApp>
let root: HTMLElement
const show = ref(false)
const edited = shallowRef<CalendarRow>()
const askedToDelete = vi.fn()
/** Opens the form: for a new calendar, as New on the Calendars page does, or to edit `calendar`. */
async function open(calendar?: CalendarRow) {
  edited.value = calendar
  show.value = true
  await nextTick()
}

const HOLIDAYS: CalendarRow = {
  name: 'personal|b',
  account: 'personal',
  id: 'b',
  _name: 'Holidays',
  color: '#30a66d',
  default: 0,
  visible: 1,
  may_write_all: 1,
  may_delete: 1,
}

beforeEach(async () => {
  window.__ = (text: string) => text
  state.save.mockReset().mockResolvedValue(undefined)
  state.failureToast.mockReset()
  askedToDelete.mockReset()
  show.value = false
  root = document.createElement('div')
  app = createApp({
    setup: () => () =>
      h(CalendarModal, {
        modelValue: show.value,
        calendar: edited.value,
        'onUpdate:modelValue': (value: boolean) => {
          show.value = value
        },
        onDelete: askedToDelete,
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

function buttons() {
  return Array.from(root.querySelectorAll('button'))
}

/** Shuts the form, then opens it to edit `calendar`, or for a new one. */
async function reopen(calendar?: CalendarRow) {
  show.value = false
  await nextTick()
  await open(calendar)
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
it('makes a calendar the default once that is ticked and saved', async () => {
  await reopen(HOLIDAYS)
  const tick = root.querySelector('input[aria-label="Set as default calendar"]')
  requireTestElement(tick, HTMLInputElement).dispatchEvent(new Event('change'))
  await nextTick()
  requireTestElement(
    buttons().find((button) => button.textContent === 'Save'),
    HTMLButtonElement,
  ).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.save).toHaveBeenCalledWith(
    'update',
    expect.objectContaining({ id: 'b', name: 'Holidays', default: true }),
  )
})
it('leaves the default alone when a calendar is only renamed', async () => {
  await reopen(HOLIDAYS)
  await saveAs('Time off')
  expect(state.save).toHaveBeenCalledWith('update', expect.objectContaining({ name: 'Time off' }))
  expect(state.save).not.toHaveBeenCalledWith('update', expect.objectContaining({ default: true }))
})
it('tells its opener that Delete was pressed, and deletes nothing itself', async () => {
  await reopen(HOLIDAYS)
  expect(buttons().map((button) => button.textContent)).toEqual(['Delete', 'Save'])
  const [deleteButton] = buttons()
  deleteButton.click()
  expect(askedToDelete).toHaveBeenCalledOnce()
  expect(state.save).not.toHaveBeenCalled()
})
it.each([
  ['the default calendar', { default: 1 }],
  ['a calendar the account may not delete', { may_delete: 0 }],
  ['a new calendar', undefined],
] as const)('has no Delete for %s', async (_, change) => {
  await reopen(change && { ...HOLIDAYS, ...change })
  expect(buttons().map((button) => button.textContent)).toEqual(['Save'])
})
it('has no default to tick on the calendar that is the default, or on a new one', async () => {
  await reopen({ ...HOLIDAYS, default: 1 })
  expect(root.querySelector('input[type="checkbox"]')).toBeNull()
  await reopen()
  expect(root.querySelector('input[type="checkbox"]')).toBeNull()
})
