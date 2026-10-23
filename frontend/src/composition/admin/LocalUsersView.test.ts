import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { api, client } from '@/api'
import { translationPlugin } from '@/platform/translation'

import LocalUsersView from './LocalUsersView.vue'

vi.mock('frappe-ui', async () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  FrappeUIProvider: { template: '<slot />' },
  ...(await import('../../../../node_modules/frappe-ui/src/components/Avatar')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Badge')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Dropdown')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/FormControl')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Progress')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Skeleton')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/TextInput')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Tooltip')),
}))

const server = vi.hoisted(() => {
  const state: {
    status: string
    account: string
    writes: unknown[]
    bulk: boolean
    failLeah: boolean
    blocker: 'personal_limit' | 'unknown_usage' | 'drive_limit' | null
  } = {
    status: 'Setup failed',
    account: 'leah@example.com',
    writes: [],
    bulk: false,
    failLeah: true,
    blocker: null,
  }
  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(url), 'http://suite.test').pathname
    const json = (data: unknown) => new Response(JSON.stringify({ data }))
    if (path.endsWith('enable_members') || path.endsWith('disable_members')) {
      const body = JSON.parse(String(init.body))
      state.writes.push({ path, body })
      return new Response(
        JSON.stringify({
          message: body.names.map((user: string) => ({
            user,
            success: user !== 'leah@example.com' || !state.failLeah,
            error: user === 'leah@example.com' && state.failLeah ? 'Mail setup is not ready' : null,
          })),
        }),
      )
    }
    if (init.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      state.writes.push(body)
      if (body.user === 'leah@example.com' && state.failLeah)
        return new Response(
          JSON.stringify({
            errors: [{ type: 'ValidationError', message: 'Mail setup is not ready' }],
          }),
          { status: 400 },
        )
      return json([])
    }
    if (init.method === 'POST' || init.method === 'DELETE') {
      state.writes.push({
        path,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        ...(init.method === 'DELETE'
          ? {
              confirmation: new URL(String(url), 'http://suite.test').searchParams.get(
                'confirmation',
              ),
            }
          : {}),
      })
      if (path.endsWith('/drive-transfer'))
        return json({
          complete: false,
          remaining: 1,
          results: [{ node: 'retained-file', success: false, error: 'Destination is unavailable' }],
        })
      return json({
        success: false,
        user: 'leah@example.com',
        status: state.status,
        error: 'Provider unavailable. Retry this account.',
        temporary_password: null,
        expires_at: null,
      })
    }
    if (path.endsWith('/drive-transfer'))
      return json({
        source_root: 'source-root',
        destination_user: 'maya@example.com',
        destination: 'destination-folder',
        fingerprint: 'preview-token',
        item_count: 1,
        bytes: 2e9,
        destination_capacity: {
          stored_bytes: 1e9,
          mail_bytes: 1e9,
          reserved_bytes: 1e9,
          current_bytes: 2e9,
          projected_bytes: 4e9,
          cap_bytes: 10e9,
          buffer_bytes: 1e9,
          effective_threshold_bytes: 11e9,
          complete: true,
          blocker: state.blocker,
        },
        inherited_grants: [{ principal: 'maya@example.com', role: 10 }],
      })
    if (path === '/api/suite/users')
      return json([
        {
          name: 'leah@example.com',
          email: 'leah@example.com',
          full_name: 'Leah',
          user_image: null,
          enabled: false,
          is_admin: false,
          account: state.account || null,
          setup_status: state.status,
          must_change_password: false,
        },
        ...(state.bulk
          ? [
              {
                name: 'maya@example.com',
                email: 'maya@example.com',
                full_name: 'Maya',
                user_image: null,
                enabled: false,
                is_admin: false,
                account: 'maya@example.com',
                setup_status: 'Active',
                must_change_password: false,
              },
            ]
          : []),
      ])
    if (path === '/api/suite/storage')
      return json({
        cloud: true,
        users: [],
        roots: [],
        drive_bytes: 0,
        personal_drive_bytes: 0,
        shared_drive_bytes: 0,
        mail_bytes: 0,
        group_mail_bytes: 0,
        combined_bytes: 0,
        reserved_bytes: 0,
        allowance_bytes: null,
        effective_allowance_bytes: null,
        default_cap_bytes: null,
        pending_invitations: 0,
        fetched_at: null,
        stale: false,
      })
    throw new Error(`Unexpected request: ${path}`)
  }
  return state
})

let app: ReturnType<typeof createApp> | undefined
beforeEach(() => {
  server.status = 'Setup failed'
  server.account = 'leah@example.com'
  server.writes = []
  server.bulk = false
  server.failLeah = true
  server.blocker = null
})
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
})
async function mount(openActions = true, initialTransferUser?: string) {
  await client.query(api.suite.users.list)
  await client.query(api.suite.storage.get)
  const element = document.createElement('div')
  document.body.append(element)
  app = createApp(LocalUsersView, { embedded: true, initialTransferUser })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/account/:accountId', name: 'mail-account', component: { template: '<div />' } },
    ],
  })
  app.use(router)
  await router.push('/')
  await router.isReady()
  app.use(translationPlugin)
  app.mount(element)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Leah'))
  if (openActions) await click('Actions for Leah')
}
async function click(label: string) {
  await vi.waitFor(() => {
    const element = Array.from(
      document.querySelectorAll('button,[role="menuitem"],[role="checkbox"]'),
    ).find(
      (element) =>
        element.textContent?.trim() === label || element.getAttribute('aria-label') === label,
    )
    expect(element, label).toBeDefined()
    if (element instanceof HTMLButtonElement) expect(element.disabled, label).toBe(false)
    if (element instanceof HTMLElement) element.click()
  })
}

it('retries failed setup on the same Suite identity and claimed address', async () => {
  await mount()
  await click('Retry Mail setup')
  await vi.waitFor(() => expect(document.querySelector('input[type="email"]')).not.toBeNull())
  const address = document.querySelector<HTMLInputElement>('input[type="email"]')
  expect(address?.value).toBe('leah@example.com')
  expect(address?.readOnly).toBe(true)
  await click('Retry setup')
  await vi.waitFor(() => expect(server.writes).toHaveLength(1))
  expect(server.writes[0]).toEqual({
    path: '/api/suite/users/leah%40example.com/mail-account',
    body: { address: 'leah@example.com' },
  })
  await vi.waitFor(() => expect(document.body.textContent).toContain('Provider unavailable'))
})

it('offers mailbox recreation and retained Drive transfer when no Mail account exists', async () => {
  server.status = 'Deleted'
  server.account = ''
  await mount()
  expect(document.body.textContent).toContain('Recreate Mail account')
  expect(document.body.textContent).toContain('Transfer Drive')
})

it('requires the retained address before retrying failed deletion', async () => {
  server.status = 'Deletion failed'
  await mount()
  await click('Retry Mail deletion')
  await vi.waitFor(() => expect(document.body.textContent).toContain('Type the account address'))
  const confirm = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Delete Mail account',
  )
  expect(confirm?.disabled).toBe(true)
  expect(server.writes).toHaveLength(0)
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')
  expect(input).not.toBeNull()
  if (input) {
    input.value = 'leah@example.com'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await click('Delete Mail account')
  await vi.waitFor(() => expect(server.writes).toHaveLength(1))
  expect(server.writes[0]).toEqual({
    path: '/api/suite/users/leah%40example.com/mail-account',
    body: undefined,
    confirmation: 'leah@example.com',
  })
  await vi.waitFor(() => expect(document.body.textContent).toContain('Provider unavailable'))
})

it.each([
  { action: 'Reactivate selected users', endpoint: 'enable_members', outcome: 'Reactivated' },
  { action: 'Disable selected users', endpoint: 'disable_members', outcome: 'Disabled' },
])(
  'preserves successful $outcome outcomes and retries only failed users',
  async ({ action, endpoint, outcome }) => {
    server.bulk = true
    await mount(false)
    await click('Select all')
    await click(action)
    await click('Confirm')
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(`maya@example.com: ${outcome}`),
    )
    expect(document.body.textContent).toContain('leah@example.com: Mail setup is not ready')
    expect(server.writes).toEqual([
      {
        path: `/api/method/suite.mail.api.admin.${endpoint}`,
        body: { names: ['leah@example.com', 'maya@example.com'] },
      },
    ])
    server.failLeah = false
    await click('Retry failed users')
    await vi.waitFor(() => expect(server.writes).toHaveLength(2))
    expect(server.writes[1]).toEqual({
      path: `/api/method/suite.mail.api.admin.${endpoint}`,
      body: { names: ['leah@example.com'] },
    })
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(`leah@example.com: ${outcome}`),
    )
  },
)

it('requires access confirmation and preserves per-item transfer failures for retry', async () => {
  await mount()
  await click('Transfer Drive')
  await vi.waitFor(() => expect(document.body.textContent).toContain('Destination folder'))
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="Paste a folder link or paste its ID"]',
  )
  expect(input).not.toBeNull()
  if (input) {
    input.value = 'destination-folder'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await click('Preview transfer')
  await vi.waitFor(() => expect(document.body.textContent).toContain('maya@example.com'))
  expect(document.body.textContent).toContain('Destination usage: 2 GB')
  expect(document.body.textContent).toContain('Usage after transfer: 4 GB')
  expect(document.body.textContent).toContain('Destination limit: 11 GB')
  expect(document.body.textContent).toContain('In progress: 1 GB')
  expect(document.body.textContent).toContain('maya@example.com · Read')
  const transferButton = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Transfer next batch',
  )
  expect(transferButton?.disabled).toBe(true)
  const checkbox = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="checkbox"]',
  )
  expect(checkbox).not.toBeNull()
  checkbox?.click()
  await click('Transfer next batch')
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('retained-file: Destination is unavailable'),
  )
  expect(document.body.textContent).toContain('1 retained nodes remain')
  expect(document.body.textContent).not.toContain('Transfer complete')
})

it.each(['personal_limit', 'unknown_usage', 'drive_limit'] as const)(
  'keeps transfer blocked when the destination reports %s',
  async (blocker) => {
    server.blocker = blocker
    await mount(false, 'leah@example.com')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Destination folder'))
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Paste a folder link or paste its ID"]',
    )
    if (input) {
      input.value = 'destination-folder'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await click('Preview transfer')
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        blocker === 'unknown_usage'
          ? 'Destination usage is unavailable'
          : 'The destination does not have enough storage',
      ),
    )
    document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')?.click()
    const button = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Transfer next batch',
    )
    expect(button?.disabled).toBe(true)
    expect(server.writes).toHaveLength(0)
  },
)
