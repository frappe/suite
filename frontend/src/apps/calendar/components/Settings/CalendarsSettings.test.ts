import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import CalendarsSettings from './CalendarsSettings.vue'

const state = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/apps/calendar/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    calendars: { data: [] },
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
vi.mock('@/apps/calendar/composables/useCalendarActions', () => ({
  useCalendarActions: () => ({ showEdit: false, showDelete: false }),
}))
vi.mock('@/apps/calendar/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/calendar/components/Modals/CalendarModal.vue', () => ({
  default: { render: () => null },
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
  // Read as the calendar list's menu loads, though no calendar is listed here
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

beforeEach(() => {
  window.__ = (text: string) => text
  state.save.mockReset().mockResolvedValue(undefined)
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
