import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { createApiClient } from '@/platform/server-state'
import { createTransport } from '@/platform/transport'

import AddAccountModal from './AddAccountModal.vue'

// Plain stand-ins: each field is a native control named by its label, so the test fills the
// form the way a person does. Everything between the form and `fetch` is the real request layer.
vi.mock('frappe-ui', () => {
  const field = defineComponent({
    props: ['modelValue', 'label', 'placeholder', 'type', 'options'],
    emits: ['update:modelValue'],
    setup:
      (props, { emit }) =>
      () =>
        props.type === 'select'
          ? h(
              'select',
              {
                'aria-label': props.label,
                value: props.modelValue,
                onChange: (event: Event) =>
                  emit('update:modelValue', (event.target as HTMLSelectElement).value),
              },
              (props.options as { label: string; value: string }[]).map((option) =>
                h('option', { value: option.value }, option.label),
              ),
            )
          : h('input', {
              'aria-label': props.label ?? props.placeholder,
              value: props.modelValue,
              onInput: (event: Event) =>
                emit('update:modelValue', (event.target as HTMLInputElement).value),
            }),
  })
  const toggle = defineComponent({
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
    setup:
      (props, { emit }) =>
      () =>
        h('input', {
          type: 'checkbox',
          'aria-label': props.label,
          checked: props.modelValue,
          onChange: (event: Event) =>
            emit('update:modelValue', (event.target as HTMLInputElement).checked),
        }),
  })
  const empty = defineComponent({ setup: () => () => null })
  return {
    Button: defineComponent({
      props: ['label'],
      setup:
        (props, { slots }) =>
        () =>
          h('button', props.label ?? slots.default?.()),
    }),
    Combobox: field,
    Dialog: defineComponent({
      props: ['open', 'title', 'actions'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? h('div', { role: 'dialog' }, [
                slots.default?.(),
                ...(props.actions as { label: string; onClick: () => void }[]).map((action) =>
                  h('button', { onClick: action.onClick }, action.label),
                ),
              ])
            : null,
    }),
    ErrorMessage: defineComponent({
      props: ['message'],
      setup: (props) => () => (props.message ? h('p', { role: 'alert' }, props.message) : null),
    }),
    FormControl: field,
    LoadingIndicator: empty,
    MultiSelect: empty,
    Switch: toggle,
  }
})
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/apps/mail/utils/datetime', () => ({
  toLocalInput: () => '2026-10-27T18:00',
  fromLocalInput: (value: string) => (value ? '2026-10-27T12:30:00Z' : ''),
  utcFromNow: () => '2026-10-27T12:30:00Z',
}))
vi.mock('@/apps/mail/composables/useEnabledDomains', () => ({
  useEnabledDomains: () => ({ domains: { data: ['northwind.test'] }, domainsError: undefined }),
}))
vi.mock('@/apps/mail/composables/useAccountOptions', () => ({
  useAccountOptions: () => ({ localeOptions: [], timeZoneOptions: [] }),
}))

const engine = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof createApiClient> | undefined,
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useMutation: ((...args: Parameters<typeof import('@/api').useMutation>) =>
    engine.current!.useMutation(...args)) as typeof import('@/api').useMutation,
  useQuery: () => ({ data: { items: [] }, refetch: async () => {} }),
}))

const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
let cleanup: (() => void) | undefined
beforeEach(() => {
  window.__ = (text: string) => text
  fetcher.mockReset()
  feedback.mockReset()
  reloads.mockReset()
  engine.current = createApiClient(
    { mail: () => import('@/apps/mail/client/policy').then((module) => module.registration) },
    { transport: createTransport({ fetch: fetcher }), persistence: false, feedback },
  )
})
afterEach(() => {
  cleanup?.()
  engine.current?.dispose()
})

const reloads = vi.fn()
async function openDialog() {
  const root = document.createElement('div')
  document.body.append(root)
  const show = ref(false)
  const app = createApp({
    setup: () => () =>
      h(AddAccountModal, {
        modelValue: show.value,
        'onUpdate:modelValue': (value: boolean) => (show.value = value),
        onReload: reloads,
      }),
  })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  // Opened after mounting, as the Users page does: opening is what seeds the form.
  show.value = true
  await nextTick()
  return root
}

function fill(root: HTMLElement, label: string, value: string) {
  const control = root.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${label}"]`,
  )!
  control.value = value
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'))
}

function click(root: HTMLElement, label: string) {
  Array.from(root.querySelectorAll('button'))
    .find((button) => button.textContent === label)!
    .click()
}

const sentBody = () =>
  JSON.parse(String(fetcher.mock.calls[0]![1]!.body)) as Record<string, unknown>

describe('Add user', () => {
  it('sends an invitation for an admin with the fields the server takes', async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            success: true,
            user: 'lena@northwind.test',
            status: 'Invited',
            error: null,
            temporary_password: null,
            expires_at: '2026-10-27T12:30:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const root = await openDialog()
    fill(root, 'Primary email username', 'lena')
    fill(root, 'yourdomain.com', 'northwind.test')
    fill(root, 'Role', 'admin')
    fill(root, 'Existing contact email', 'lena@example.com')
    await nextTick()
    click(root, 'Send invitation')

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    expect(sentBody()).toEqual({
      username: 'lena',
      domain: 'northwind.test',
      aliases: [],
      groups: [],
      mailing_lists: [],
      is_admin: true,
      send_invite: true,
      backup_email: 'lena@example.com',
      expires_at: '2026-10-27T12:30:00Z',
      disable_receiving: false,
      first_name: '',
      last_name: '',
      quota_gb: 0,
      locale: 'en-US',
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    expect(feedback).not.toHaveBeenCalled()
  })

  it('adds a normal user right away without an admin flag', async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            success: true,
            user: 'theo@northwind.test',
            status: 'Active',
            error: null,
            temporary_password: 'Temp-1234',
            expires_at: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const root = await openDialog()
    fill(root, 'Primary email username', 'theo')
    fill(root, 'yourdomain.com', 'northwind.test')
    root.querySelector<HTMLInputElement>('[aria-label="Send Invite"]')!.click()
    await nextTick()
    fill(root, 'First Name', 'Theo')
    click(root, 'Add user')

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    expect(sentBody()).toMatchObject({ username: 'theo', is_admin: false, send_invite: false })
    expect(sentBody()).not.toHaveProperty('role')
    expect(feedback).not.toHaveBeenCalled()
  })

  it('asks for a first name before creating an account right away', async () => {
    const root = await openDialog()
    fill(root, 'Primary email username', 'theo')
    fill(root, 'yourdomain.com', 'northwind.test')
    root.querySelector<HTMLInputElement>('[aria-label="Send Invite"]')!.click()
    await nextTick()
    click(root, 'Add user')
    await nextTick()

    expect(fetcher).not.toHaveBeenCalled()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('first name')
  })

  it('shows why a creation failed and sends the Users list to pick it up', async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            success: false,
            user: 'theo@northwind.test',
            status: 'Setup failed',
            error: 'Account setup failed: Invalid value for enum type Locale.',
            temporary_password: null,
            expires_at: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const root = await openDialog()
    fill(root, 'Primary email username', 'theo')
    fill(root, 'yourdomain.com', 'northwind.test')
    root.querySelector<HTMLInputElement>('[aria-label="Send Invite"]')!.click()
    await nextTick()
    fill(root, 'First Name', 'Theo')
    click(root, 'Add user')

    await vi.waitFor(() => expect(reloads).toHaveBeenCalledWith(false))
    await nextTick()
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'Account setup failed: Invalid value for enum type Locale.',
    )
  })
})
