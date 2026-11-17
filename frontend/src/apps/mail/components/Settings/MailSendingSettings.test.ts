import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { openSettings, settingsSection } from '@/platform/settings'
import { requireTestElement } from '@/platform/testing/dom'

import MailSendingSettings from './MailSendingSettings.vue'

const state = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    sieveScripts: { data: [] },
    identities: reactive({
      isFetching: false,
      data: [
        {
          name: 'personal|a',
          id: 'a',
          account: 'personal',
          email: 'maya@example.com',
          _name: 'Maya',
          reply_to: [],
          bcc: [],
          html_signature: '',
          may_delete: 0,
        },
      ],
    }),
  }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
// The parts this file doesn't open
vi.mock('./ComposeSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('./SignatureSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/Controls/MailRichTextField.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/mail/components/IdentitySettingsListView.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/mail/components/Modals/SetSieveScriptStateModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api },
    useQuery: (reference: { id: string }) => {
      if (reference.id !== 'get_vacation_response') {
        return reactive({ data: [] })
      }

      return reactive({
        isFetching: false,
        data: { enabled: 1, from_date: null, to_date: null, subject: 'Away', html_body: '' },
        refetch: async () => {},
      })
    },
    useMutation: (reference: { id: string }) =>
      reactive({ isPending: false, run: (input: unknown) => state.save(reference.id, input) }),
  }
})
vi.mock('frappe-ui', () => ({
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
    props: { modelValue: { type: String, default: '' }, label: { type: String, default: '' } },
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
  Switch: { render: () => null },
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
  app = createApp(MailSendingSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
  return root
}

/** Opens the row with this title and gives back its dialog. */
async function openRow(root: HTMLElement, title: string) {
  const row = Array.from(root.querySelectorAll('section')).find((section) =>
    section.textContent.startsWith(title),
  )
  requireTestElement(row?.querySelector('button'), HTMLButtonElement).click()
  await nextTick()
  return requireTestElement(root.querySelector(`dialog[aria-label="${title}"]`), HTMLElement)
}

/** Types into the field with this label, then presses Save. */
async function saveField(dialog: HTMLElement, label: string, value: string) {
  const field = requireTestElement(
    dialog.querySelector(`input[aria-label="${label}"]`),
    HTMLInputElement,
  )
  field.value = value
  field.dispatchEvent(new Event('input'))
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
  settingsSection.value = undefined
})
afterEach(() => app.unmount())

it('closes Send-as addresses once the address is saved', async () => {
  const root = mount()
  await saveField(await openRow(root, 'Send-as addresses'), 'Display name', 'Maya K')
  expect(state.save).toHaveBeenCalledWith('save_identity', {
    account: 'personal',
    id: 'a',
    name: 'Maya K',
    reply_to: [],
    bcc: [],
    html_signature: '',
  })
  expect(root.querySelector('dialog')).toBeNull()
})
it('keeps Send-as addresses open, with what was typed, when the save is refused', async () => {
  state.save.mockRejectedValue(new Error('Not your address'))
  const root = mount()
  await saveField(await openRow(root, 'Send-as addresses'), 'Display name', 'Maya K')
  const name = root.querySelector('dialog input[aria-label="Display name"]')
  expect(requireTestElement(name, HTMLInputElement).value).toBe('Maya K')
})
it('closes Auto-reply once the reply is saved', async () => {
  const root = mount()
  await saveField(await openRow(root, 'Auto-reply'), 'Subject', 'Back on Monday')
  expect(state.save).toHaveBeenCalledWith(
    'update_vacation_response',
    expect.objectContaining({ account: 'personal', enabled: true, subject: 'Back on Monday' }),
  )
  expect(root.querySelector('dialog')).toBeNull()
})
it('keeps Auto-reply open, with what was typed, when the save is refused', async () => {
  state.save.mockRejectedValue(new Error('Dates are the wrong way round'))
  const root = mount()
  await saveField(await openRow(root, 'Auto-reply'), 'Subject', 'Back on Monday')
  const subject = root.querySelector('dialog input[aria-label="Subject"]')
  expect(requireTestElement(subject, HTMLInputElement).value).toBe('Back on Monday')
})
it.each([
  ['send-as', 'Send-as addresses'],
  ['signatures', 'Signatures'],
  ['auto-reply', 'Auto-reply'],
] as const)('opens %s when Settings is opened on it', (section, title) => {
  openSettings('mail.sending', section)
  expect(mount().querySelector('dialog')?.getAttribute('aria-label')).toBe(title)
})
