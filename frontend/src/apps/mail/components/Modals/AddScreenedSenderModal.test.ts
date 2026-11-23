import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { createApiClient } from '@/platform/server-state'
import { requireTestElement } from '@/platform/testing/dom'
import { createTransport } from '@/platform/transport'

import AddScreenedSenderModal from './AddScreenedSenderModal.vue'

// Plain stand-ins: a field is a native input named by its label, with what is wrong with it said
// under it. Everything between the form and `fetch` is the real request layer
vi.mock('frappe-ui', () => ({
  // Held by the app's own toast, which a refusal said in the form never reaches
  toast: {},
  Dialog: defineComponent({
    props: ['open', 'actions'],
    setup:
      (props, { slots }) =>
      () =>
        props.open &&
        h('div', { role: 'dialog' }, [
          slots.default?.(),
          ...fromPartial<{ label: string; disabled: boolean; onClick: () => void }[]>(
            props.actions,
          ).map((action) =>
            h('button', { disabled: action.disabled, onClick: action.onClick }, action.label),
          ),
        ]),
  }),
  FormControl: defineComponent({
    props: ['modelValue', 'label', 'error'],
    emits: ['update:modelValue'],
    setup:
      (props, { emit }) =>
      () => [
        h('input', {
          'aria-label': props.label,
          value: props.modelValue,
          onInput: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
        }),
        props.error && h('p', { role: 'alert' }, props.error),
      ],
  }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    screenedAddresses: { data: [{ email: 'noisy@example.com', action: 'Spam' }] },
  }),
}))

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const engine = vi.hoisted(() => ({
  current: fromPartial<ReturnType<typeof createApiClient> | undefined>(undefined),
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useMutation: fromPartial<typeof import('@/api').useMutation>(
    (...args: Parameters<typeof import('@/api').useMutation>) =>
      engine.current!.useMutation(...args),
  ),
}))

const fetcher = vi.fn<typeof fetch>()
const toasted = vi.fn()
let cleanup: (() => void) | undefined
let root: HTMLElement
beforeEach(async () => {
  window.__ = (text: string) => text
  fetcher.mockReset()
  toasted.mockReset()
  engine.current = createApiClient(
    { mail: async () => (await import('@/apps/mail/client/policy')).registration },
    { transport: createTransport({ fetch: fetcher }), feedback: toasted },
  )
  root = document.createElement('div')
  const show = ref(false)
  const app = createApp({
    setup: () => () =>
      h(AddScreenedSenderModal, {
        modelValue: show.value,
        'onUpdate:modelValue': (value: boolean) => {
          show.value = value
        },
      }),
  })
  app.config.globalProperties.__ = (text: string) => text
  // A refused save still rejects, and the app drops a refusal that was said already
  app.config.errorHandler = vi.fn()
  app.mount(root)
  cleanup = () => app.unmount()
  // Opened after mounting, as the page does: opening is what clears the form
  show.value = true
  await nextTick()
})
afterEach(() => {
  cleanup?.()
  engine.current?.dispose()
})

function sender() {
  return requireTestElement(root.querySelector('[aria-label="Email or domain"]'), HTMLInputElement)
}

async function type(value: string) {
  sender().value = value
  sender().dispatchEvent(new Event('input'))
  await nextTick()
}

function addButton() {
  const found = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'Add',
  )

  return requireTestElement(found, HTMLButtonElement)
}

/** What is said under the sender's field, when something is. */
function underSender() {
  const said = sender().nextElementSibling
  if (said?.getAttribute('role') !== 'alert') {
    return undefined
  }

  return said.textContent
}

it('says under the sender why the server refused it, in place of a toast', async () => {
  const reason = JSON.stringify([JSON.stringify({ message: 'You cannot screen yourself' })])
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ _server_messages: reason }), { status: 417 }),
  )
  await type('maya@example.com')
  addButton().click()
  await vi.waitFor(() => expect(underSender()).toBe('You cannot screen yourself'))
  expect(toasted).not.toHaveBeenCalled()

  // The refusal was about the sender as it was typed
  await type('maya@example.org')
  expect(underSender()).toBeUndefined()
})
it('says under the sender that it is screened already, and keeps Add off', async () => {
  await type('noisy@example.com')
  expect(underSender()).toBe('This sender is already screened.')
  expect(addButton().disabled).toBe(true)
  expect(fetcher).not.toHaveBeenCalled()
})
