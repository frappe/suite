import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { api, client } from '@/api'
import { translationPlugin } from '@/platform/translation'

import LocalUsersView from './LocalUsersView.vue'

vi.mock('frappe-ui', async () => ({
  PageHeader: { template: '<header><slot /></header>' },
  toast: { error: vi.fn(), success: vi.fn() },
  FrappeUIProvider: { template: '<slot />' },
  ...(await import('../../../../node_modules/frappe-ui/src/components/Avatar')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Badge')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Breadcrumbs')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Combobox')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Dropdown')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/FormControl')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Progress')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Skeleton')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/TextInput')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Tooltip')),
}))
// jsdom has no layout; the dropdown scrolls its highlighted option into view.
Element.prototype.scrollIntoView = () => {}
vi.mock('@/platform/area-sidebar', () => ({ openAreaSidebar: vi.fn() }))

const server = vi.hoisted(() => {
  type AdminServerState = {
    status: string
    account: string
    writes: unknown[]
    bulk: boolean
    cloud: boolean
    failLeah: boolean
    transferMovesAll: boolean
    previews: Record<string, string>[]
    /** Adds Omar, an active colleague a departed user's Drive can go to. */
    colleague: boolean
    blocker: 'personal_limit' | 'unknown_usage' | 'drive_limit' | null
  }
  const state: AdminServerState = {
    status: 'Setup failed',
    account: 'leah@example.com',
    writes: [],
    bulk: false,
    cloud: true,
    failLeah: true,
    transferMovesAll: false,
    previews: [],
    colleague: false,
    blocker: null,
  }
  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(url), 'http://suite.test').pathname
    const json = (data: unknown) => new Response(JSON.stringify({ data }))
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
      const write = { path, body: init.body ? JSON.parse(String(init.body)) : undefined }
      state.writes.push(
        init.method === 'DELETE'
          ? {
              ...write,
              confirmation: new URL(String(url), 'http://suite.test').searchParams.get(
                'confirmation',
              ),
            }
          : write,
      )
      if (path === '/api/suite/invitations')
        return json({
          disabled_user_emails: [],
          accepted_invite_emails: [],
          pending_invite_emails: [],
          invited_emails: write.body.emails.split(', '),
        })
      if (path.endsWith('/drive-transfer') && state.transferMovesAll)
        return json({
          complete: true,
          remaining: 0,
          results: [
            { node: 'retained-file', title: 'Handover notes.md', success: true, error: null },
          ],
        })
      if (path.endsWith('/drive-transfer'))
        return json({
          complete: false,
          remaining: 1,
          results: [
            {
              node: 'retained-file',
              title: 'Handover notes.md',
              success: false,
              error: 'Destination is unavailable',
            },
          ],
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
    if (path === '/api/suite/admin/shared-drives')
      return json([{ id: 'drive-finance', title: 'Finance' }])
    if (path.endsWith('/drive-transfer')) {
      const query = Object.fromEntries(new URL(String(url), 'http://suite.test').searchParams)
      state.previews.push(query)
      const shared = !!query.to_drive
      return json({
        source_root: 'source-root',
        destination_user: shared ? null : 'omar@example.com',
        destination_title: shared ? 'Finance' : 'Omar Haddad',
        folder_title: "Leah's files",
        destination: 'destination-root',
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
    }
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
        ...(state.colleague
          ? [
              {
                name: 'omar@example.com',
                email: 'omar@example.com',
                full_name: 'Omar Haddad',
                user_image: null,
                enabled: true,
                is_admin: false,
                account: 'omar@example.com',
                setup_status: 'Active',
                must_change_password: false,
              },
            ]
          : []),
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
        cloud: state.cloud,
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
  server.cloud = true
  server.failLeah = true
  server.transferMovesAll = false
  server.previews = []
  server.colleague = false
  server.blocker = null
})
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
})
async function mount(openActions = true, initialTransferUser?: string, embedded = true) {
  await client.query(api.suite.users.list)
  await client.query(api.suite.storage.get)
  const element = document.createElement('div')
  document.body.append(element)
  app = createApp(LocalUsersView, { embedded, initialTransferUser, status: 'disabled' })
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
  if (openActions) await click('Actions for leah@example.com')
}
/** Opens the Transfer to dropdown and picks the option with this label. */
async function pickTarget(label: string) {
  const field = () => document.querySelector<HTMLInputElement>('[role="dialog"] [role="combobox"]')
  await vi.waitFor(() => expect(field()).not.toBeNull())
  field()!.focus()
  field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await vi.waitFor(() =>
    expect(
      Array.from(document.querySelectorAll('[role="option"]')).some((o) =>
        o.textContent?.includes(label),
      ),
    ).toBe(true),
  )
  Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    .find((o) => o.textContent?.includes(label))!
    .click()
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
  {
    action: 'Reactivate',
    confirm: 'Reactivate users',
    enabled: true,
    outcome: 'Reactivated',
  },
  {
    action: 'Disable',
    confirm: 'Disable users',
    enabled: false,
    outcome: 'Disabled',
  },
])(
  'preserves successful $outcome outcomes and retries only failed users',
  async ({ action, confirm, enabled, outcome }) => {
    server.bulk = true
    await mount(false)
    await click('Select all')
    await click(action)
    await click(confirm)
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(`maya@example.com: ${outcome}`),
    )
    // The server's own reason for the refusal, not a generic failure.
    expect(document.body.textContent).toContain('leah@example.com: Mail setup is not ready')
    expect(server.writes).toEqual([
      { user: 'leah@example.com', enabled },
      { user: 'maya@example.com', enabled },
    ])
    server.failLeah = false
    await click('Retry failed users')
    await vi.waitFor(() => expect(server.writes).toHaveLength(3))
    expect(server.writes[2]).toEqual({ user: 'leah@example.com', enabled })
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(`leah@example.com: ${outcome}`),
    )
  },
)

it('requires access confirmation and preserves per-item transfer failures for retry', async () => {
  server.colleague = true
  // Opened as the row's Transfer Drive link does; the menu path is covered above.
  await mount(false, 'leah@example.com')
  await vi.waitFor(() => expect(document.body.textContent).toContain('Transfer to'))
  await pickTarget('Omar Haddad')
  await click('Preview transfer')
  await vi.waitFor(() => expect(document.body.textContent).toContain('What moves'))
  const preview = document.querySelector('[role="dialog"] dl')?.textContent ?? ''
  expect(preview).toContain('1 item · 2 GB')
  // The destination's usage before and after, against its cap rather than the cap plus buffer.
  expect(preview).toContain('2 GB → 4 GB of 10 GB')
  expect(preview).not.toContain('11 GB')
  expect(preview).toContain('In progress1 GB')
  expect(preview).toContain('maya@example.com · Read')
  const transferButton = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Transfer',
  )
  expect(transferButton?.disabled).toBe(true)
  const checkbox = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="checkbox"]',
  )
  expect(checkbox).not.toBeNull()
  checkbox?.click()
  await click('Transfer')
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('Handover notes.md: Destination is unavailable'),
  )
  expect(document.body.textContent).toContain('1 item is left')
  expect(document.body.textContent).not.toContain('Transfer complete')
})

it('moves a departed user’s Drive into a folder in the picked person’s Drive and ends on where it went', async () => {
  server.transferMovesAll = true
  server.colleague = true
  // Opened as the row's Transfer Drive link does; the menu path is covered above.
  await mount(false, 'leah@example.com')
  await vi.waitFor(() => expect(document.body.textContent).toContain('Transfer to'))
  // Before anything is picked, the admin already sees the folder everything will land in.
  expect(document.body.textContent).toContain("Everything goes into a new folder, “Leah's files”")
  await pickTarget('Omar Haddad')
  await click('Preview transfer')
  await vi.waitFor(() => expect(document.body.textContent).toContain('What moves'))
  expect(server.previews.at(-1)).toMatchObject({ to_user: 'omar@example.com' })
  expect(server.previews.at(-1)).not.toHaveProperty('to_drive', 'drive-finance')
  expect(document.querySelector('[role="dialog"] dl')?.textContent).toContain(
    "Goes to“Leah's files” in Omar Haddad’s Drive",
  )
  document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')?.click()
  await click('Transfer')
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "Everything has moved to “Leah's files” in Omar Haddad’s Drive.",
    ),
  )
  expect(server.writes).toContainEqual(
    expect.objectContaining({
      body: expect.objectContaining({ to_user: 'omar@example.com', to_drive: null }),
    }),
  )
  expect(document.body.textContent).toContain('Handover notes.md: Moved')
  expect(document.querySelector('[role="dialog"] input')).toBeNull()
  const labels = Array.from(document.querySelectorAll('[role="dialog"] button')).map((button) =>
    button.textContent?.trim(),
  )
  expect(labels).toContain('Close')
  expect(labels).not.toContain('Preview again')
})

it('offers shared Drives by name and previews a transfer into one', async () => {
  // Opened as the row's Transfer Drive link does; the menu path is covered above.
  await mount(false, 'leah@example.com')
  await pickTarget('Finance')
  await click('Preview transfer')
  await vi.waitFor(() => expect(document.body.textContent).toContain('What moves'))
  expect(server.previews.at(-1)).toMatchObject({ to_drive: 'drive-finance' })
  expect(server.previews.at(-1)).not.toHaveProperty('to_user', 'omar@example.com')
  expect(document.querySelector('[role="dialog"] dl')?.textContent).toContain(
    "Goes to“Leah's files” in Finance",
  )
})

it.each(['personal_limit', 'unknown_usage', 'drive_limit'] as const)(
  'keeps transfer blocked when the destination reports %s',
  async (blocker) => {
    server.blocker = blocker
    server.colleague = true
    await mount(false, 'leah@example.com')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Transfer to'))
    await pickTarget('Omar Haddad')
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
      (button) => button.textContent?.trim() === 'Transfer',
    )
    expect(button?.disabled).toBe(true)
    expect(server.writes).toHaveLength(0)
  },
)

it('catches a bad invite address before sending, then sends commas-separated addresses and closes', async () => {
  server.cloud = false
  await mount(false, undefined, false)
  await click('Invite users')
  const box = () => document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')
  await vi.waitFor(() => expect(box()).not.toBeNull())
  const type = (value: string) => {
    const textarea = box()!
    textarea.value = value
    textarea.dispatchEvent(new Event('input'))
  }

  type('new@example.com, dana.whitfield@')
  await click('Send invitations')
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      '"dana.whitfield@" doesn\'t look like a valid email address.',
    ),
  )
  expect(server.writes).toEqual([])

  type('new@example.com,\nother@example.com')
  await click('Send invitations')
  await vi.waitFor(() => expect(box()).toBeNull())
  expect(server.writes).toEqual([
    { path: '/api/suite/invitations', body: { emails: 'new@example.com, other@example.com' } },
  ])
})
