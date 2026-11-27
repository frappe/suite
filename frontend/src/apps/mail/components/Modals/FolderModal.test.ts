import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import FolderModal from './FolderModal.vue'

const state = vi.hoisted(() => ({ save: vi.fn(), failureToast: vi.fn() }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ accountId: 'personal', sieveScripts: { data: [] } }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/mail/components/Modals/SetSieveScriptStateModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/platform/feedback', () => ({
  failureLine: (error: Error | null) => error?.message,
}))
vi.mock('@/api', async () => {
  const { fakeMutation } = await import('@/platform/testing/mutations')
  return {
    api: {
      mail: {
        mailboxes: { create: { id: 'create_mailbox' }, update: { id: 'update_mailbox' } },
        sieve: { createAutomation: { id: 'create_automation' } },
      },
    },
    useMutation: (reference: { id: string }, options?: { silent?: boolean }) =>
      fakeMutation((input) => state.save(reference.id, input), state.failureToast, options),
  }
})
// Plain stand-ins: a field is a native input named by its label, the dialog's own buttons follow
// what is in it, and the tabs show the General tab
vi.mock('frappe-ui', () => {
  const empty = { render: () => null }
  return {
    Alert: empty,
    Button: empty,
    SettingsRow: defineComponent({
      props: { title: { type: String, default: '' } },
      setup(props, { slots }) {
        return () => h('label', [props.title, slots.default?.()])
      },
    }),
    Switch: defineComponent({
      props: { modelValue: Boolean },
      emits: ['update:modelValue'],
      setup(props, { emit }) {
        return () =>
          h('input', {
            type: 'checkbox',
            checked: props.modelValue,
            onChange: (event: Event) =>
              emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).checked),
          })
      },
    }),
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
    ErrorMessage: defineComponent({
      props: { message: { type: String, default: undefined } },
      setup(props) {
        return () => props.message && h('p', { role: 'alert' }, props.message)
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
    Tabs: defineComponent({
      setup(_, { slots }) {
        return () => h('div', slots.default?.())
      },
    }),
    TabButtons: empty,
    TabList: empty,
    TabTrigger: empty,
    TabPanel: defineComponent({
      props: { value: { type: String, default: '' } },
      setup(props, { slots }) {
        return () => (props.value === 'general' ? h('div', slots.default?.()) : null)
      },
    }),
  }
})

let app: ReturnType<typeof createApp>
let root: HTMLElement
const show = ref(false)
/** Opens the form for a new folder, as New in Your folders does. */
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
      h(FolderModal, {
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

function said() {
  return root.querySelector('[role="alert"]')?.textContent
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

it('says in the form why a folder was refused, in place of a toast', async () => {
  state.save.mockRejectedValue(new Error('A folder named Bills already exists'))
  await saveAs('Bills')
  expect(said()).toBe('A folder named Bills already exists')
  expect(state.failureToast).not.toHaveBeenCalled()
  expect(show.value).toBe(true)
})
it('opens again without what the last visit was refused', async () => {
  state.save.mockRejectedValue(new Error('A folder named Bills already exists'))
  await saveAs('Bills')
  show.value = false
  await nextTick()
  await open()
  expect(said()).toBeUndefined()
})

// The folder stores an opt-out, and the switch once showed it as such: on meant no notifications
it('sends push notifications for a new folder until its switch is turned off', async () => {
  const push = requireTestElement(root.querySelector('input[type="checkbox"]'), HTMLInputElement)
  expect(push.closest('label')?.textContent).toBe('Notifications')
  expect(push.checked).toBe(true)
  push.checked = false
  push.dispatchEvent(new Event('change'))
  await saveAs('Bills')
  expect(state.save).toHaveBeenCalledWith(
    'create_mailbox',
    expect.objectContaining({ disable_push_notification: true }),
  )
})
