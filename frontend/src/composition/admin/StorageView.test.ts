import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { api, client } from '@/api'
import { translationPlugin } from '@/platform/translation'

import StorageView from './StorageView.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/components/Alert')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Avatar')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Badge')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Breadcrumbs')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/FormControl')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Progress')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Skeleton')),
}))
vi.mock('@/platform/area-sidebar', () => ({ openAreaSidebar: vi.fn() }))

vi.hoisted(() => {
  globalThis.fetch = async (url: RequestInfo | URL) => {
    const path = new URL(String(url), 'http://suite.test').pathname
    if (path === '/api/suite/storage')
      return new Response(
        JSON.stringify({
          data: {
            cloud: true,
            drive_bytes: 18e9,
            personal_drive_bytes: 18e9,
            shared_drive_bytes: 0,
            group_mail_bytes: 0,
            pending_invitations: 0,
            reserved_bytes: 0,
            mail_bytes: 4e9,
            combined_bytes: 22e9,
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
              cap_bytes: 10e9,
              effective_cap_bytes: 11e9,
              mail_fetched_at: null,
            })),
          },
        }),
      )
    return new Response(JSON.stringify({ data: {} }))
  }
})

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
})

async function render() {
  await client.query(api.suite.storage.get)
  const root = document.createElement('div')
  document.body.append(root)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/storage', component: { template: '<div />' } }],
  })
  await router.push('/admin/storage')
  const app = createApp(StorageView)
  app.use(router).use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  await vi.waitFor(() => expect(document.querySelector('[aria-label="Select all"]')).not.toBeNull())
}

function button(label: string) {
  const match = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  )
  if (!match) throw new Error(`Missing ${label} button`)
  return match
}

describe('Storage actions', () => {
  it('shows each configured limit and offers no separate extra-storage actions', async () => {
    await render()
    expect(document.body.textContent).toContain('10 GB')
    const labels = [...document.querySelectorAll('button')].map((item) => item.textContent?.trim())
    expect(labels).not.toContain('Give 10% extra storage')
    expect(labels).not.toContain('Remove extra storage')
    expect(document.body.textContent).not.toContain('10% extra')
    document.querySelector<HTMLElement>('[aria-label="Select all"]')!.click()
    await vi.waitFor(() => expect(button('Set limits').disabled).toBe(false))
    button('Set limits').click()
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'Set storage limits',
      ),
    )
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Extra storage')
  })
})
