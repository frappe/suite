import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import CalendarsSettings from './CalendarsSettings.vue'

interface MenuOption {
  label: string
  condition?: () => boolean
  onClick: () => void
}

/** What the page's fakes share with the tests. */
interface Fakes {
  save: Mock
  failureToast: Mock
  calendars: Record<string, unknown>[]
}

const state = vi.hoisted((): Fakes => ({
  save: vi.fn(),
  failureToast: vi.fn(),
  calendars: [],
}))
vi.mock('@/apps/calendar/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    calendars: {
      get data() {
        return state.calendars
      },
    },
    participantIdentities: reactive({
      isFetching: false,
      data: [
        {
          name: 'personal|a',
          id: 'a',
          account: 'personal',
          email: 'maya@example.com',
          _name: 'Maya',
          default: 1,
        },
        {
          name: 'personal|b',
          id: 'b',
          account: 'personal',
          email: 'billing@example.com',
          _name: 'Billing',
          default: 0,
        },
      ],
    }),
  }),
}))
vi.mock('@/apps/calendar/utils', async (original) => ({
  ...(await original<typeof import('@/apps/calendar/utils')>()),
  raiseToast: vi.fn(),
}))
vi.mock('@/apps/calendar/utils/color', () => ({ eventColor: () => 'green' }))
// Stands in for the edit dialog: says which calendar it is open on, and has its Delete button
vi.mock('@/apps/calendar/components/Modals/CalendarModal.vue', () => ({
  default: defineComponent({
    props: { modelValue: Boolean, calendar: { type: Object, default: undefined } },
    emits: ['delete'],
    setup(props, { emit }) {
      return () => {
        if (!props.modelValue) {
          return null
        }

        return h('dialog', [
          `Edit ${props.calendar?._name}`,
          h('button', { onClick: () => emit('delete') }, 'Delete'),
        ])
      }
    },
  }),
}))
// Lists what the menu offers beside its button, as the real one does once opened
vi.mock('@/platform/feedback', () => ({
  Dropdown: defineComponent(
    (props: { options: MenuOption[] }, { slots }) =>
      () => {
        const offered = props.options.filter((option) => option.condition?.() ?? true)
        return h('menu', [
          slots.default?.(),
          offered.map((option) => h('li', { onClick: option.onClick }, option.label)),
        ])
      },
    { props: ['options'] },
  ),
  failureLine: (error: Error | null) => error?.message,
}))
// Stands in for the question asked before a calendar is deleted: says which calendar it asks about
vi.mock('@/apps/calendar/components/Modals/DeleteCalendarModal.vue', () => ({
  default: defineComponent({
    props: { modelValue: Boolean, calendar: { type: Object, default: undefined } },
    setup(props) {
      return () => {
        if (!props.modelValue) {
          return null
        }

        return h('dialog', `Delete ${props.calendar?._name}?`)
      }
    },
  }),
}))
vi.mock('@/api', async () => {
  const { fakeMutation } = await import('@/platform/testing/mutations')
  return {
    api: {
      mail: {
        participantIdentities: {
          create: { id: 'add_participant_identity' },
          update: { id: 'update_participant_identity' },
          delete: { id: 'delete_participant_identity' },
        },
      },
    },
    useMutation: (reference: { id: string }, options?: { silent?: boolean }) =>
      fakeMutation((input) => state.save(reference.id, input), state.failureToast, options),
  }
})
vi.mock('frappe-ui', () => ({
  toast: { create: vi.fn() },
  Badge: { render: () => null },
  ErrorMessage: defineComponent({
    props: { message: { type: String, default: undefined } },
    setup(props) {
      return () => props.message && h('p', { role: 'alert' }, props.message)
    },
  }),
  SettingsHeader: { render: () => null },
  SettingsBody: defineComponent({
    setup(_, { slots }) {
      return () => h('main', slots.default?.())
    },
  }),
  Button: defineComponent({
    props: { label: { type: String, default: '' } },
    setup(props) {
      return () => h('button', props.label)
    },
  }),
  // A dialog's own buttons, such as a small form's Save, follow what is in it
  Dialog: defineComponent({
    props: {
      open: Boolean,
      title: { type: String, default: '' },
      actions: { type: Array<{ label: string; onClick: () => void }>, default: () => [] },
    },
    setup(props, { slots }) {
      return () => {
        if (!props.open) {
          return null
        }

        const actionButtons = props.actions.map((action) =>
          h('button', { onClick: action.onClick }, action.label),
        )
        return h('dialog', { 'aria-label': props.title }, [slots.default?.(), actionButtons])
      }
    },
  }),
  FormControl: defineComponent({
    props: {
      modelValue: { type: [String, Boolean], default: '' },
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
  SettingsRow: defineComponent({
    props: { title: { type: String, default: '' } },
    setup(props, { slots }) {
      return () => h('section', [props.title, slots.default?.()])
    },
  }),
}))

/** The words as they are shown, with what they name filled in. */
function shown(message: string, named?: unknown) {
  // What is named comes as a list, or as nothing
  const values = [named].flat()

  return message.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]))
}

let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(CalendarsSettings)
  app.config.globalProperties.__ = shown
  app.config.errorHandler = vi.fn()
  app.mount(root)
  return root
}

/** Presses the button called `label` in `within`. */
async function press(within: HTMLElement, label: string) {
  const button = Array.from(within.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  )
  requireTestElement(button, HTMLButtonElement).click()
  await nextTick()
}

/** Opens Invite addresses: the dialog that lists them. */
async function openAddresses(root: HTMLElement) {
  const row = Array.from(root.querySelectorAll('section')).find((section) =>
    section.textContent.startsWith('Invite addresses'),
  )
  requireTestElement(row?.querySelector('button'), HTMLButtonElement).click()
  await nextTick()
  return requireTestElement(root.querySelector('dialog'), HTMLElement)
}

/** The fields of the page that is open in Invite addresses. */
function fields(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll('input')).map((input) => input.ariaLabel)
}

/** Types `value` into the field called `label`. */
async function type(dialog: HTMLElement, label: string, value: string) {
  const field = requireTestElement(
    dialog.querySelector(`input[aria-label="${label}"]`),
    HTMLInputElement,
  )
  field.value = value
  field.dispatchEvent(new Event('input'))
  await nextTick()
  return field
}

/** Presses Save on the page that is open, and waits for the answer. */
async function save(dialog: HTMLElement) {
  await press(dialog, 'Save')
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Opens Maya's address from the list, types a new name, then presses Save. */
async function saveNewName(root: HTMLElement) {
  const dialog = await openAddresses(root)
  const maya = Array.from(dialog.querySelectorAll('button')).find((button) =>
    button.textContent.includes('maya@example.com'),
  )
  requireTestElement(maya, HTMLButtonElement).click()
  await nextTick()
  await type(dialog, 'Display name', 'Maya K')
  await save(dialog)
  return dialog
}

/** Opens Invite addresses, then its page for a new address. */
async function openNewAddress(root: HTMLElement) {
  const dialog = await openAddresses(root)
  await press(dialog, 'New address')
  return dialog
}

/** The lines of the “…” menu of the address `email`, as the list shows them. */
function menuOf(dialog: HTMLElement, email: string) {
  const more = dialog.querySelector(`button[aria-label="More for ${email}"]`)
  return Array.from(requireTestElement(more?.closest('menu'), HTMLElement).querySelectorAll('li'))
}

/** Picks `label` from the “…” menu of the address `email`. */
async function pick(dialog: HTMLElement, email: string, label: string) {
  const line = menuOf(dialog, email).find((each) => each.textContent === label)
  requireTestElement(line, HTMLElement).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The row of the calendar called `name` in Your calendars. */
function calendarRow(root: HTMLElement, name: string) {
  const title = Array.from(root.querySelectorAll('span')).find((span) => span.textContent === name)
  return requireTestElement(title?.parentElement?.parentElement, HTMLElement)
}

function buttons(row: HTMLElement) {
  return Array.from(row.querySelectorAll('button')).map(
    (button) => button.getAttribute('aria-label') ?? button.textContent,
  )
}

function listCalendars() {
  const own = { account: 'personal', color: null, visible: 1 }
  state.calendars = [
    {
      ...own,
      name: 'personal|a',
      id: 'a',
      _name: 'Work',
      default: 1,
      may_write_all: 1,
      may_delete: 1,
    },
    {
      ...own,
      name: 'personal|b',
      id: 'b',
      _name: 'Holidays',
      default: 0,
      may_write_all: 1,
      may_delete: 1,
    },
    {
      ...own,
      name: 'team|c',
      id: 'c',
      _name: 'Company',
      default: 0,
      may_write_all: 0,
      may_delete: 0,
    },
  ]
}

beforeEach(() => {
  window.__ = shown
  state.save.mockReset().mockResolvedValue(undefined)
  state.failureToast.mockReset()
  state.calendars = []
})
afterEach(() => app.unmount())

it('goes back to the list of invite addresses once an address is saved', async () => {
  const dialog = await saveNewName(mount())
  expect(state.save).toHaveBeenCalledWith('update_participant_identity', {
    account: 'personal',
    id: 'a',
    name: 'Maya K',
    email: 'maya@example.com',
  })
  expect(fields(dialog)).toEqual([])
  expect(menuOf(dialog, 'billing@example.com')).not.toEqual([])
})
it('keeps an invite address open, with what was typed, when the save is refused', async () => {
  state.save.mockRejectedValue(new Error('Not your address'))
  const dialog = await saveNewName(mount())
  const name = dialog.querySelector('input[aria-label="Display name"]')
  expect(requireTestElement(name, HTMLInputElement).value).toBe('Maya K')
})
it('says on an invite address why its save was refused, in place of a toast', async () => {
  state.save.mockRejectedValue(new Error('Not your address'))
  const dialog = await saveNewName(mount())
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('Not your address')
  expect(state.failureToast).not.toHaveBeenCalled()
})
it('asks for an email address before it sends a new invite address that is not one', async () => {
  const form = await openNewAddress(mount())
  await type(form, 'Email address', 'billing')
  await save(form)
  expect(form.querySelector('[role="alert"]')?.textContent).toBe('Enter a valid email address')
  expect(state.save).not.toHaveBeenCalled()
})
it('says under a new invite address why it was refused, until it is retyped', async () => {
  state.save.mockRejectedValue(new Error('That domain is not yours'))
  const form = await openNewAddress(mount())
  const email = await type(form, 'Email address', 'billing@example.com')
  await save(form)
  expect(email.nextElementSibling?.textContent).toBe('That domain is not yours')
  expect(state.failureToast).not.toHaveBeenCalled()

  await type(form, 'Email address', 'billing@example.org')
  expect(form.querySelector('[role="alert"]')).toBeNull()
})
it('creates the invite address that was typed, then lists the addresses again', async () => {
  const form = await openNewAddress(mount())
  await type(form, 'Email address', 'events@example.com')
  await type(form, 'Display name', 'Events')
  await save(form)
  expect(state.save).toHaveBeenCalledWith('add_participant_identity', {
    account: 'personal',
    email: 'events@example.com',
    name: 'Events',
  })
  expect(fields(form)).toEqual([])
})
it('offers to make an invite address the default only where it is not, and does so', async () => {
  const dialog = await openAddresses(mount())
  function offered(email: string) {
    return menuOf(dialog, email).map((line) => line.textContent)
  }

  expect(offered('maya@example.com')).toEqual(['Edit', 'Delete'])
  expect(offered('billing@example.com')).toEqual(['Set as default', 'Edit', 'Delete'])

  await pick(dialog, 'billing@example.com', 'Set as default')
  expect(state.save).toHaveBeenCalledWith('update_participant_identity', {
    account: 'personal',
    id: 'b',
    name: 'Billing',
    email: 'billing@example.com',
    default: true,
  })
})
it('asks before it deletes an invite address, then deletes the one that was picked', async () => {
  const dialog = await openAddresses(mount())
  await pick(dialog, 'billing@example.com', 'Delete')
  expect(state.save).not.toHaveBeenCalled()

  const question = dialog.querySelector('dialog[aria-label="Delete this invite address?"]')
  await press(requireTestElement(question, HTMLElement), 'Delete invite address')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.save).toHaveBeenCalledWith('delete_participant_identity', {
    names: ['personal|b'],
  })
  expect(dialog.querySelector('dialog')).toBeNull()
})

it('gives a calendar you can edit one button, Edit, which opens that calendar', async () => {
  listCalendars()
  const root = mount()
  expect(buttons(calendarRow(root, 'Work'))).toEqual(['Edit'])
  expect(buttons(calendarRow(root, 'Holidays'))).toEqual(['Edit'])
  expect(buttons(calendarRow(root, 'Company'))).toEqual([])
  await press(calendarRow(root, 'Holidays'), 'Edit')
  expect(root.querySelector('dialog')?.textContent).toContain('Edit Holidays')
})
it('asks about deleting the calendar whose edit dialog Delete was pressed in', async () => {
  listCalendars()
  const root = mount()
  await press(calendarRow(root, 'Holidays'), 'Edit')
  await press(requireTestElement(root.querySelector('dialog'), HTMLElement), 'Delete')
  const open = Array.from(root.querySelectorAll('dialog')).map((dialog) => dialog.textContent)
  expect(open).toEqual(['Delete Holidays?'])
})
