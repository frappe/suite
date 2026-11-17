import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import CalendarsSettings from './CalendarsSettings.vue'

interface MenuOption {
  label: string
  condition: () => boolean
}

/** What the page's fakes share with the tests. */
interface Fakes {
  save: Mock
  calendars: Record<string, unknown>[]
}

const state = vi.hoisted((): Fakes => ({
  save: vi.fn(),
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
      ],
    }),
  }),
}))
vi.mock('@/apps/calendar/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/calendar/utils/color', () => ({ eventColor: () => 'green' }))
// Stands in for the edit dialog: says which calendar it is open on
vi.mock('@/apps/calendar/components/Modals/CalendarModal.vue', () => ({
  default: defineComponent({
    props: { modelValue: Boolean, calendar: { type: Object, default: undefined } },
    setup(props) {
      return () => {
        if (!props.modelValue) {
          return null
        }

        return h('dialog', `Edit ${props.calendar?._name}`)
      }
    },
  }),
}))
// Lists what the menu offers beside its button, as the real one does once opened
vi.mock('@/platform/feedback', () => ({
  Dropdown: defineComponent(
    (props: { options: MenuOption[] }, { slots }) =>
      () => {
        const shown = props.options.filter((option) => option.condition())
        return h('menu', [slots.default?.(), shown.map((option) => h('li', option.label))])
      },
    { props: ['options'] },
  ),
}))
vi.mock('@/apps/calendar/components/Modals/DeleteCalendarModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/api', () => ({
  api: {
    mail: {
      participantIdentities: {
        create: { id: 'add_participant_identity' },
        update: { id: 'update_participant_identity' },
        delete: { id: 'delete_participant_identity' },
      },
    },
  },
  useMutation: (reference: { id: string }) =>
    reactive({ isPending: false, run: (input: unknown) => state.save(reference.id, input) }),
}))
vi.mock('frappe-ui', () => ({
  toast: { create: vi.fn() },
  Badge: { render: () => null },
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
  Dialog: defineComponent({
    props: { open: Boolean, title: { type: String, default: '' } },
    setup(props, { slots }) {
      return () => {
        if (!props.open) {
          return null
        }

        return h('dialog', { 'aria-label': props.title }, slots.default?.())
      }
    },
  }),
  FormControl: defineComponent({
    props: {
      modelValue: { type: [String, Boolean], default: '' },
      label: { type: String, default: '' },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('input', {
          'aria-label': props.label,
          value: props.modelValue,
          onInput: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
        })
    },
  }),
  SettingsRow: defineComponent({
    props: { title: { type: String, default: '' } },
    setup(props, { slots }) {
      return () => h('section', [props.title, slots.default?.()])
    },
  }),
}))

let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(CalendarsSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
  return root
}

/** Opens Invite addresses, types a new name, then presses Save. */
async function saveNewName(root: HTMLElement) {
  const row = Array.from(root.querySelectorAll('section')).find((section) =>
    section.textContent.startsWith('Invite addresses'),
  )
  requireTestElement(row?.querySelector('button'), HTMLButtonElement).click()
  await nextTick()
  const dialog = requireTestElement(root.querySelector('dialog'), HTMLElement)
  const name = requireTestElement(
    dialog.querySelector('input[aria-label="Display name"]'),
    HTMLInputElement,
  )
  name.value = 'Maya K'
  name.dispatchEvent(new Event('input'))
  await nextTick()
  const save = Array.from(dialog.querySelectorAll('button')).find(
    (button) => button.textContent === 'Save',
  )
  requireTestElement(save, HTMLButtonElement).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The row of the calendar called `name` in Your calendars. */
function calendarRow(root: HTMLElement, name: string) {
  const title = Array.from(root.querySelectorAll('span')).find((span) => span.textContent === name)
  return requireTestElement(title?.parentElement?.parentElement, HTMLElement)
}

/** What the menu on the row of the calendar called `name` offers. */
function offered(root: HTMLElement, name: string) {
  return Array.from(calendarRow(root, name).querySelectorAll('li')).map((item) => item.textContent)
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
  window.__ = (text: string) => text
  state.save.mockReset().mockResolvedValue(undefined)
  state.calendars = []
})
afterEach(() => app.unmount())

it('closes Invite addresses once the address is saved', async () => {
  const root = mount()
  await saveNewName(root)
  expect(state.save).toHaveBeenCalledWith('update_participant_identity', {
    account: 'personal',
    id: 'a',
    name: 'Maya K',
    email: 'maya@example.com',
    default: true,
  })
  expect(root.querySelector('dialog')).toBeNull()
})
it('keeps Invite addresses open, with what was typed, when the save is refused', async () => {
  state.save.mockRejectedValue(new Error('Not your address'))
  const root = mount()
  await saveNewName(root)
  const name = root.querySelector('dialog input[aria-label="Display name"]')
  expect(requireTestElement(name, HTMLInputElement).value).toBe('Maya K')
})

it('gives each calendar you can edit its own Edit button, which opens that calendar', async () => {
  listCalendars()
  const root = mount()
  expect(buttons(calendarRow(root, 'Work'))).toEqual(['Edit'])
  expect(buttons(calendarRow(root, 'Company'))).toEqual([])
  const edit = Array.from(calendarRow(root, 'Holidays').querySelectorAll('button')).find(
    (button) => button.textContent === 'Edit',
  )
  requireTestElement(edit, HTMLButtonElement).click()
  await nextTick()
  expect(root.querySelector('dialog')?.textContent).toBe('Edit Holidays')
})
it('keeps Edit out of the menu, and the menu off a calendar with nothing else to offer', () => {
  listCalendars()
  const root = mount()
  expect(buttons(calendarRow(root, 'Holidays'))).toEqual(['Calendar options', 'Edit'])
  expect(offered(root, 'Holidays')).toEqual(['Set as Default', 'Delete'])
  // The default can't be deleted or made default again, so its row has no menu
  expect(offered(root, 'Work')).toEqual([])
})
