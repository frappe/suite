import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import SignatureSettings from './SignatureSettings.vue'

const state = vi.hoisted(() => ({ run: vi.fn(), toast: vi.fn() }))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: state.toast }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
vi.mock('@/components/AdaptiveDropdown.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/Controls/MailRichTextField.vue', () => ({
  default: defineComponent({
    props: { modelValue: { type: String, default: '' } },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('textarea', {
          value: props.modelValue,
          onInput: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLTextAreaElement).value),
        })
    },
  }),
}))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api },
    useQuery: () =>
      reactive({
        data: [{ name: 'sig-1', signature_name: 'Work', html_body: '<p>Regards</p>' }],
      }),
    useMutation: (reference: { id: string }) =>
      reactive({ isPending: false, run: (input: unknown) => state.run(reference.id, input) }),
  }
})
vi.mock('frappe-ui', () => ({
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
}))

let app: ReturnType<typeof createApp>
let root: HTMLElement
function mount() {
  root = document.createElement('div')
  app = createApp(SignatureSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
}

function button(name: string) {
  const found = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === name || candidate.getAttribute('aria-label') === name,
  )

  return requireTestElement(found, HTMLButtonElement)
}

function nameField() {
  return root.querySelector<HTMLInputElement>('input[aria-label="Name"]')
}

async function type(field: Element | null, value: string) {
  const control = requireTestElement(field, HTMLElement)
  Object.assign(control, { value })
  control.dispatchEvent(new Event('input'))
  await nextTick()
}

/** Opens the saved signature, as a click on its line in the list does. */
async function openSaved() {
  const line = Array.from(root.querySelectorAll('span')).find((span) => span.textContent === 'Work')
  requireTestElement(line, HTMLElement).click()
  await nextTick()
}

async function press(name: string) {
  button(name).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  window.__ = (text: string) => text
  state.run.mockReset().mockResolvedValue(undefined)
  state.toast.mockReset()
  mount()
})
afterEach(() => app.unmount())

it('opens a signature in place of the list, and the arrow goes back to the list', async () => {
  await openSaved()
  expect(nameField()?.value).toBe('Work')
  expect(root.textContent).not.toContain('New signature')

  await press('Back to signatures')
  expect(nameField()).toBeNull()
  expect(root.textContent).toContain('Work')
  expect(state.run).not.toHaveBeenCalled()
})
it('saves an edit under the signature it was opened from, then shows the list', async () => {
  await openSaved()
  await type(nameField(), 'Work, short')
  await press('Save')
  expect(state.run).toHaveBeenCalledWith('update_signature', {
    name: 'sig-1',
    signature_name: 'Work, short',
    html_body: '<p>Regards</p>',
  })
  expect(nameField()).toBeNull()
  expect(state.toast).toHaveBeenCalledWith('Signature updated')
})
it('creates a signature from New signature, then shows the list', async () => {
  await press('New signature')
  expect(nameField()?.value).toBe('')

  await type(nameField(), 'Home')
  await type(root.querySelector('textarea'), '<p>Bye</p>')
  await press('Save')
  expect(state.run).toHaveBeenCalledWith('create_signature', {
    signature_name: 'Home',
    html_body: '<p>Bye</p>',
  })
  expect(nameField()).toBeNull()
  expect(state.toast).toHaveBeenCalledWith('Signature created')
})
it('keeps Save off until the signature has both a name and a body', async () => {
  await press('New signature')
  expect(button('Save').disabled).toBe(true)

  await type(nameField(), 'Home')
  expect(button('Save').disabled).toBe(true)

  await type(root.querySelector('textarea'), '<p>Bye</p>')
  expect(button('Save').disabled).toBe(false)
})
it('keeps the form, with what was typed, when the save is refused', async () => {
  state.run.mockRejectedValue(new Error('Name already used'))
  await openSaved()
  await type(nameField(), 'Home')
  await press('Save')
  expect(nameField()?.value).toBe('Home')
  expect(state.toast).not.toHaveBeenCalled()
})
