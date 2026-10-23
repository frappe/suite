import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { api, client } from '@/api'
import { translationPlugin } from '@/platform/translation'

import EditAccountQuotaModal from './EditAccountQuotaModal.vue'
import StorageLimitDialog from './StorageLimitDialog.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Alert')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Avatar')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Badge')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Breadcrumbs')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/FormControl')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Skeleton')),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/platform/area-sidebar', () => ({ openAreaSidebar: vi.fn() }))

const server = vi.hoisted(() => {
  const state = {
    fail: true,
    bulk: false,
    cap: 20e9,
    writes: [] as Record<string, unknown>[],
  }
  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(url), 'http://suite.test').pathname
    if (path === '/api/suite/storage/limits') {
      const input = JSON.parse(String(init.body))
      state.writes.push(input)
      return new Response(
        JSON.stringify({
          data: input.users.map((user: string) => {
            const failure = state.fail && (!state.bulk || user === 'leah@example.com')
            return { user, success: !failure, error: failure ? 'Please try again' : null }
          }),
        }),
      )
    }
    if (path === '/api/suite/storage')
      return new Response(
        JSON.stringify({
          data: {
            cloud: true,
            drive_bytes: 9e9,
            personal_drive_bytes: 9e9,
            shared_drive_bytes: 0,
            group_mail_bytes: 0,
            pending_invitations: 0,
            reserved_bytes: 0,
            mail_bytes: 2e9,
            combined_bytes: 11e9,
            allowance_bytes: 100e9,
            effective_allowance_bytes: 110e9,
            default_cap_bytes: null,
            stale: false,
            fetched_at: null,
            roots: [],
            users: ['maya', 'leah'].map((name) => ({
              name: `${name}@example.com`,
              email: `${name}@example.com`,
              full_name: name === 'maya' ? 'Maya' : 'Leah',
              user_image: null,
              enabled: true,
              is_admin: false,
              drive_bytes: 9e9,
              reserved_bytes: 0,
              mail_bytes: 2e9,
              combined_bytes: 11e9,
              cap_bytes: state.cap,
              effective_cap_bytes: state.cap * 1.1,
              mail_fetched_at: null,
            })),
          },
        }),
      )
    return new Response(JSON.stringify({ data: {} }))
  }
  return state
})

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  server.fail = true
  server.bulk = false
  server.cap = 20e9
  server.writes.length = 0
})

async function render(bulk = false) {
  await client.query(api.suite.storage.get)
  const root = document.createElement('div')
  document.body.append(root)
  const open = ref(true)
  const reload = vi.fn()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  const app = createApp({
    render: () =>
      bulk
        ? h(StorageLimitDialog, {
            users: ['maya@example.com', 'leah@example.com'],
            closeOnSuccess: false,
            open: open.value,
            'onUpdate:open': (value: boolean) => {
              open.value = value
            },
            onSaved: reload,
          })
        : h(EditAccountQuotaModal, {
            member: { name: 'maya@example.com', quota: { total: 20 } },
            modelValue: open.value,
            'onUpdate:modelValue': (value: boolean) => {
              open.value = value
            },
            onReload: reload,
          }),
  })
  app.use(router).use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  await vi.waitFor(() => expect(document.querySelector('input[type="number"]')).not.toBeNull())
  return { open, reload }
}

function button(label: string) {
  const match = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  )
  if (!match) throw new Error(`Missing ${label} button`)
  return match
}

describe('Account storage limits', () => {
  it('keeps a failed save visible and only reloads after successful retry', async () => {
    const { open, reload } = await render()
    button('Save').click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('Please try again'))
    expect(open.value).toBe(true)
    expect(reload).not.toHaveBeenCalled()
    server.fail = false
    button('Retry failed').click()
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(open.value).toBe(false)
  })

  it('warns only when usage exceeds the new limit plus its automatic 10% headroom', async () => {
    await render()
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!
    input.value = '10'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(document.body.textContent).toContain('11 GB used · limit 11 GB'))
    expect(document.body.textContent).not.toContain('will need to free up space')
    input.value = '9'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Maya will need to free up space'),
    )
    expect(document.body.textContent).toContain('11 GB used · limit 9.9 GB')
    expect(document.body.textContent).toContain('Mail will keep working')
    expect(document.body.textContent).not.toContain('Extra storage')
  })

  it('keeps successful bulk outcomes and retries only failed users with the original limit', async () => {
    server.bulk = true
    const { reload } = await render(true)
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!
    input.value = '10'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    button('Save').click()
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('leah@example.com: Please try again'),
    )
    expect(document.body.textContent).toContain('maya@example.com: Saved')
    expect(reload).not.toHaveBeenCalled()
    server.fail = false
    button('Retry failed').click()
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(server.writes).toEqual([
      { users: ['maya@example.com', 'leah@example.com'], cap_bytes: 10e9 },
      { users: ['leah@example.com'], cap_bytes: 10e9 },
    ])
    expect(document.body.textContent).toContain('maya@example.com: Saved')
    expect(document.body.textContent).toContain('leah@example.com: Saved')
  })
})
