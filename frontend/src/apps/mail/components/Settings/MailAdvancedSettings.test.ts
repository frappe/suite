import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { openSettings, settingsSection } from '@/platform/settings'
import { requireTestElement } from '@/platform/testing/dom'

import MailAdvancedSettings from './MailAdvancedSettings.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const state = vi.hoisted(() => ({
  servers: [{ protocol: 'IMAP', hostname: 'mail.example.com', port: 993 }],
  asked: new Set<string>(),
  save: vi.fn(),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ userResource: { data: { api_key: '' } } }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn(), copyToClipBoard: vi.fn() }))
// The parts this file doesn't open
vi.mock('./ImportSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('./ExportSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('./PushSubscriptionSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api, suite: { account: { generateKeys: { id: 'generate_keys' } } } },
    useQuery: (reference: { id: string }) => {
      state.asked.add(reference.id)
      if (reference.id !== 'credentials') {
        return reactive({ data: state.servers })
      }

      return reactive({
        data: { username: 'maya', has_password: true },
        refetch: async () => {},
      })
    },
    useMutation: () => {
      const result = reactive({
        error: fromPartial<Error | null>(null),
        isPending: false,
        run: async (input: unknown) => {
          try {
            await state.save(input)
          } catch (error) {
            result.error = fromPartial<Error>(error)
            throw error
          }
        },
      })
      return result
    },
  }
})
vi.mock('frappe-ui', () => ({
  Badge: { render: () => null },
  Tooltip: { render: () => null },
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
  ErrorMessage: defineComponent({
    props: { message: { type: String, default: '' } },
    setup(props) {
      return () => h('p', props.message)
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
  app = createApp(MailAdvancedSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
  return root
}

/** The button of the row with this title. */
function rowButton(root: HTMLElement, title: string) {
  const row = Array.from(root.querySelectorAll('section')).find((section) =>
    section.textContent.startsWith(title),
  )
  return requireTestElement(row?.querySelector('button'), HTMLButtonElement)
}

async function openLoginDetails(root: HTMLElement) {
  rowButton(root, 'Login details').click()
  await nextTick()
  return requireTestElement(root.querySelector('dialog'), HTMLElement)
}

async function saveNewUsername(dialog: HTMLElement) {
  const username = requireTestElement(
    dialog.querySelector('input[aria-label="Username"]'),
    HTMLInputElement,
  )
  username.value = 'maya.k'
  username.dispatchEvent(new Event('input'))
  await nextTick()
  const save = Array.from(dialog.querySelectorAll('button')).find(
    (button) => button.textContent === 'Save',
  )
  requireTestElement(save, HTMLButtonElement).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  window.__ = (text: string) => text
  state.servers = [{ protocol: 'IMAP', hostname: 'mail.example.com', port: 993 }]
  state.asked.clear()
  state.save.mockReset().mockResolvedValue(undefined)
  settingsSection.value = undefined
})
afterEach(() => app.unmount())

it('reads a part only once its row is opened', async () => {
  const root = mount()
  expect(root.querySelector('dialog')).toBeNull()
  expect(state.asked.has('credentials')).toBe(false)
  const dialog = await openLoginDetails(root)
  expect(dialog.getAttribute('aria-label')).toBe('Login details')
  expect(state.asked.has('credentials')).toBe(true)
})
it('leaves out Mail client setup on a site that gives no servers', () => {
  state.servers = []
  const root = mount()
  expect(root.textContent).not.toContain('Mail client setup')
  expect(root.textContent).toContain('API access')
})
it('closes Login details once the save goes through', async () => {
  const root = mount()
  await saveNewUsername(await openLoginDetails(root))
  expect(state.save).toHaveBeenCalledWith({ username: 'maya.k', backup_email: null })
  expect(root.querySelector('dialog')).toBeNull()
})
it('keeps Login details open, with the reason, when the save is refused', async () => {
  state.save.mockRejectedValue(new Error('Wrong app password'))
  const root = mount()
  await saveNewUsername(await openLoginDetails(root))
  expect(root.querySelector('dialog')?.textContent).toContain('Wrong app password')
})
it.each([
  ['login-details', 'Login details'],
  ['client-setup', 'Mail client setup'],
  ['api-access', 'API access'],
] as const)('opens %s when Settings is opened on it', (section, title) => {
  openSettings('mail.advanced', section)
  expect(mount().querySelector('dialog')?.getAttribute('aria-label')).toBe(title)
})
