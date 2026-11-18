import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { translationPlugin } from '@/platform/translation'

import UsersView from './UsersView.vue'

vi.mock('frappe-ui', async () => ({
  PageHeader: { template: '<header><slot /></header>' },
  toast: { error: vi.fn(), success: vi.fn() },
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
vi.mock('@/platform/area-sidebar', () => ({ openAreaSidebar: vi.fn() }))

vi.hoisted(() => {
  // The instance answers at once; the directory itself stays loading.
  globalThis.fetch = async (url: RequestInfo | URL) => {
    if (new URL(String(url), 'http://suite.test').pathname !== '/api/suite/storage')
      return new Promise<Response>(() => {})
    return new Response(
      JSON.stringify({
        data: {
          cloud: false,
          drive_bytes: 0,
          personal_drive_bytes: 0,
          shared_drive_bytes: 0,
          mail_bytes: 0,
          combined_bytes: 0,
          group_mail_bytes: 0,
          pending_invitations: 0,
          reserved_bytes: 0,
          allowance_bytes: null,
          effective_allowance_bytes: null,
          default_cap_bytes: null,
          fetched_at: '2026-11-18T00:00:00Z',
          stale: false,
          users: [],
          roots: [],
        },
      }),
    )
  }
})

let cleanup = () => {}
afterEach(() => cleanup())

it('keeps the Users header on screen while the local directory loads', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/users', component: UsersView }],
  })
  await router.push('/admin/users')
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(UsersView).use(router).use(translationPlugin)
  app.mount(root)
  // Each observer callback sees the DOM as the next painted frame would.
  const framesWithoutHeader: string[] = []
  const observer = new MutationObserver(() => {
    if (!root.querySelector('header')?.textContent?.includes('Users'))
      framesWithoutHeader.push(root.innerHTML)
  })
  observer.observe(root, { childList: true, subtree: true })
  cleanup = () => {
    observer.disconnect()
    app.unmount()
    root.remove()
  }

  // "Invite users" belongs to the local directory, so it has replaced the loading view.
  await vi.waitFor(() => expect(root.textContent).toContain('Invite users'), {
    timeout: 3000,
  })

  expect(framesWithoutHeader).toEqual([])
  expect(root.querySelector('header')?.textContent).toContain('Users')
})
