import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import IdentitySettings from './IdentitySettings.vue'

interface Address {
  name: string
  id: string
  account: string
  email: string
  _name: string
  reply_to: { email: string; display_name: string }[]
  bcc: { email: string; display_name: string }[]
  html_signature: string
  may_delete: 0 | 1
}

const state = vi.hoisted(() => {
  const addresses: Address[] = []

  return { run: vi.fn(), toast: vi.fn(), change: vi.fn(), addresses, savedDefault: '' }
})
vi.mock('@/apps/mail/composables/useAccountPreferences', () => ({
  useAccountPreferences: () => ({
    preferences: { value: { default_outgoing_email: state.savedDefault } },
    change: state.change,
  }),
}))
interface Option {
  label: string
  condition?: () => boolean
  onClick: () => void
}
// As the real one in what the tests look at: a button for each option whose condition holds
vi.mock('@/components/AdaptiveDropdown.vue', () => ({
  default: defineComponent({
    props: {
      options: { type: Array<Option>, default: () => [] },
      title: { type: String, default: '' },
    },
    setup(props) {
      return () =>
        h(
          'menu',
          { 'aria-label': props.title },
          props.options
            .filter((option) => option.condition?.() ?? true)
            .map((option) => h('button', { onClick: option.onClick }, option.label)),
        )
    },
  }),
}))
vi.mock('@/apps/mail/utils', async (original) => ({
  ...(await original()),
  raiseToast: state.toast,
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'oa',
    identities: reactive({ isFetching: false, data: state.addresses }),
  }),
}))
vi.mock('@/apps/mail/components/Controls/MailRichTextField.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api },
    useQuery: () => reactive({ data: [] }),
    useMutation: (reference: { id: string }) =>
      reactive({ isPending: false, run: (input: unknown) => state.run(reference.id, input) }),
  }
})
vi.mock('frappe-ui', () => ({
  toast: vi.fn(),
  Badge: defineComponent({
    props: { label: { type: String, default: '' } },
    setup(props) {
      return () => h('span', props.label)
    },
  }),
  Button: defineComponent({
    props: { label: { type: String, default: '' }, disabled: Boolean },
    setup(props) {
      return () => h('button', { disabled: props.disabled }, props.label)
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
  // As the real one in what the tests look at: nothing while closed, the message and a button
  // for each action while open
  Dialog: defineComponent({
    props: {
      open: Boolean,
      title: { type: String, default: '' },
      message: { type: String, default: '' },
      actions: { type: Array<{ label: string; onClick: () => void }>, default: () => [] },
    },
    setup(props, { slots }) {
      return () => {
        if (!props.open) {
          return null
        }

        return h('dialog', { 'aria-label': props.title }, [
          props.message,
          slots.default?.(),
          props.actions.map((action) => h('button', { onClick: action.onClick }, action.label)),
        ])
      }
    },
  }),
}))

const me: Address = {
  name: 'oa|a',
  id: 'a',
  account: 'oa',
  email: 'me@example.com',
  _name: 'Me',
  reply_to: [],
  bcc: [],
  html_signature: '',
  may_delete: 0,
}
const sales: Address = {
  ...me,
  name: 'oa|b',
  id: 'b',
  email: 'sales@example.com',
  _name: 'Sales',
  may_delete: 1,
}

let app: ReturnType<typeof createApp>
let root: HTMLElement
function mount(addresses: Address[]) {
  state.addresses.splice(0, Infinity, ...addresses)
  root = document.createElement('div')
  app = createApp(IdentitySettings)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
}

function findButton(name: string) {
  return Array.from(root.querySelectorAll('button')).find(
    (candidate) =>
      candidate.textContent.trim() === name || candidate.getAttribute('aria-label') === name,
  )
}

async function press(name: string) {
  requireTestElement(findButton(name), HTMLButtonElement).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function field(label: string) {
  return root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
}

async function type(label: string, value: string) {
  const input = requireTestElement(field(label), HTMLInputElement)
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

/** The box of addresses under this label. */
function addressBox(label: string) {
  const name = Array.from(root.querySelectorAll('p')).find((part) => part.textContent === label)

  return name?.parentElement?.querySelector('input') ?? null
}

/** Types an address into a box and leaves the box, which is when it joins the list. */
async function addAddress(label: string, value: string) {
  const box = requireTestElement(addressBox(label), HTMLInputElement)
  box.value = value
  box.dispatchEvent(new Event('input'))
  await nextTick()
  box.dispatchEvent(new Event('blur'))
  await nextTick()
}

/** The lines of the list, each as the words a reader sees on it. */
function lines() {
  return Array.from(root.querySelectorAll('button[type="button"]')).map((line) =>
    Array.from(line.querySelectorAll('span'), (part) => part.textContent).join(' '),
  )
}

/** The words on an address's menu, the menu going by the address's name. */
function menu(title: string) {
  return Array.from(
    root.querySelectorAll(`menu[aria-label="${title}"] button`),
    (option) => option.textContent,
  )
}

async function pressOnMenu(title: string, name: string) {
  const option = Array.from(root.querySelectorAll(`menu[aria-label="${title}"] button`)).find(
    (candidate) => candidate.textContent === name,
  )
  requireTestElement(option, HTMLButtonElement).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Opens an address from the list, as a click on its line does. */
async function openAddress(email: string) {
  const line = Array.from(root.querySelectorAll('button[type="button"]')).find((candidate) =>
    candidate.textContent.includes(email),
  )
  requireTestElement(line, HTMLButtonElement).click()
  await nextTick()
}

beforeEach(() => {
  window.__ = (text: string) => text
  state.run.mockReset().mockResolvedValue(undefined)
  state.toast.mockReset()
  state.change.mockReset()
  state.savedDefault = ''
})
afterEach(() => app.unmount())

it('opens on the list of addresses, each with its name and email', () => {
  mount([me, sales])
  expect(lines()).toEqual(['Me me@example.com Default', 'Sales sales@example.com'])
  expect(field('Display name')).toBeNull()
})
it('marks the saved default address, whatever its letter case', () => {
  state.savedDefault = 'SALES@example.com'
  mount([me, sales])
  expect(lines()).toEqual(['Me me@example.com', 'Sales sales@example.com Default'])
})
it('makes an address the default from its menu, and offers that only on the others', async () => {
  mount([me, sales])
  expect(menu('Me')).not.toContain('Set as default')

  await pressOnMenu('Sales', 'Set as default')
  expect(state.change).toHaveBeenCalledWith({ default_outgoing_email: 'sales@example.com' })
})
it('opens an address from Edit on its menu', async () => {
  mount([me, sales])
  await pressOnMenu('Sales', 'Edit')
  expect(field('Display name')?.value).toBe('Sales')
})
it('opens an address in place of the list, and the arrow goes back to the list', async () => {
  mount([me, sales])
  await openAddress('sales@example.com')
  expect(field('Display name')?.value).toBe('Sales')
  expect(lines()).toEqual([])

  await press('Back to addresses')
  expect(field('Display name')).toBeNull()
  expect(lines()).toHaveLength(2)
  expect(state.run).not.toHaveBeenCalled()
})
it('saves the address that is open, then shows the list', async () => {
  mount([me, sales])
  await openAddress('sales@example.com')
  await type('Display name', 'Sales team')
  await press('Save')
  expect(state.run).toHaveBeenCalledWith('save_identity', {
    account: 'oa',
    id: 'b',
    name: 'Sales team',
    reply_to: [],
    bcc: [],
    html_signature: '',
  })
  expect(state.toast).toHaveBeenCalledWith('Address updated')
  expect(lines()).toHaveLength(2)
})
it('keeps Save off until the address is changed', async () => {
  mount([me])
  await openAddress('me@example.com')
  expect(findButton('Save')?.disabled).toBe(true)

  await type('Display name', 'Maya')
  expect(findButton('Save')?.disabled).toBe(false)
})
it('keeps the address open, with what was typed, when the save is refused', async () => {
  state.run.mockRejectedValue(new Error('Not your address'))
  mount([me])
  await openAddress('me@example.com')
  await type('Display name', 'Maya')
  await press('Save')
  expect(field('Display name')?.value).toBe('Maya')
  expect(state.toast).not.toHaveBeenCalled()
})
it('keeps Reply-to and Bcc behind a button until the address uses one', async () => {
  const support = { ...sales, bcc: [{ email: 'log@example.com', display_name: '' }] }
  mount([me, support])
  await openAddress('me@example.com')
  expect(addressBox('Reply-to')).toBeNull()

  await press('Add reply-to or Bcc')
  expect(addressBox('Reply-to')).not.toBeNull()
  expect(addressBox('Bcc')).not.toBeNull()

  await press('Back to addresses')
  await openAddress('sales@example.com')
  expect(root.textContent).toContain('log@example.com')
})
it('saves the addresses of each box, one saved with a display name keeping it', async () => {
  const support = { ...sales, reply_to: [{ email: 'help@example.com', display_name: 'Help desk' }] }
  mount([support])
  await openAddress('sales@example.com')
  await addAddress('Reply-to', 'desk@example.com')
  await addAddress('Bcc', 'log@example.com')
  await press('Save')
  expect(state.run).toHaveBeenCalledWith(
    'save_identity',
    expect.objectContaining({
      reply_to: [
        { email: 'help@example.com', display_name: 'Help desk' },
        { email: 'desk@example.com', display_name: '' },
      ],
      bcc: [{ email: 'log@example.com', display_name: '' }],
    }),
  )
})
it('keeps Save off while a box holds something that is not an email address', async () => {
  mount([me])
  await openAddress('me@example.com')
  await press('Add reply-to or Bcc')
  await addAddress('Reply-to', 'not an address')
  expect(findButton('Save')?.disabled).toBe(true)
})
it('creates an address on this account from New address, then shows the list', async () => {
  mount([me])
  await press('New address')
  expect(findButton('Save')?.disabled).toBe(true)

  await type('Email address', 'billing@example.com')
  await type('Display name', 'Billing')
  await press('Save')
  expect(state.run).toHaveBeenCalledWith('add_identity', {
    account: 'oa',
    email: 'billing@example.com',
    name: 'Billing',
  })
  expect(state.toast).toHaveBeenCalledWith('Address created')
  expect(field('Email address')).toBeNull()
})
it('says there are no addresses yet, and still offers New address', () => {
  mount([])
  expect(root.textContent).toContain('No send-as addresses yet')
  expect(findButton('New address')).toBeDefined()
})
it('offers Delete only for an address the server lets go', () => {
  mount([me, sales])
  expect(menu('Me')).not.toContain('Delete')
  expect(menu('Sales')).toContain('Delete')
})
it('asks first, then deletes the address by its name', async () => {
  mount([me, sales])
  await pressOnMenu('Sales', 'Delete')
  expect(root.querySelector('dialog')?.textContent).toContain('This cannot be undone.')
  expect(state.run).not.toHaveBeenCalled()

  await press('Delete address')
  expect(state.run).toHaveBeenCalledWith('delete_identity_names', { names: ['oa|b'] })
  expect(state.toast).toHaveBeenCalledWith('Address deleted')
  expect(root.querySelector('dialog')).toBeNull()
})
it('keeps the question open when the delete is refused', async () => {
  state.run.mockRejectedValue(new Error('In use'))
  mount([me, sales])
  await pressOnMenu('Sales', 'Delete')
  await press('Delete address')
  expect(root.querySelector('dialog')?.getAttribute('aria-label')).toBe('Delete this address?')
  expect(state.toast).not.toHaveBeenCalled()
})
