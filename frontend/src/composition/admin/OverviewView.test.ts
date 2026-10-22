import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { api, client } from '@/api'
import { translationPlugin } from '@/platform/translation'
import type { StorageGetOutput } from '@/platform/transport/generated'

import OverviewView from './OverviewView.vue'
import SiteStorageSummary from './SiteStorageSummary.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/components/Alert')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Avatar')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Badge')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Breadcrumbs')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Progress')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Skeleton')),
}))
vi.mock('@/platform/area-sidebar', () => ({ openAreaSidebar: vi.fn() }))

const server = vi.hoisted(() => {
  const state = {
    cloud: true,
    domainCalls: 0,
    failDomains: false,
    failUsers: false,
    pagedDomains: false,
    noDomains: false,
  }
  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(url), 'http://suite.test').pathname
    const json = (data: unknown) => new Response(JSON.stringify({ data }))
    if (path === '/api/suite/storage')
      return json({
        cloud: state.cloud,
        drive_bytes: 50e9,
        personal_drive_bytes: 40e9,
        shared_drive_bytes: 10e9,
        mail_bytes: state.cloud ? 45e9 : 0,
        combined_bytes: state.cloud ? 95e9 : 50e9,
        group_mail_bytes: state.cloud ? 3e9 : 0,
        pending_invitations: 3,
        reserved_bytes: 2e9,
        allowance_bytes: state.cloud ? 100e9 : null,
        effective_allowance_bytes: state.cloud ? 110e9 : null,
        default_cap_bytes: null,
        fetched_at: '2026-10-12T10:00:00Z',
        stale: false,
        users: [
          {
            name: 'maya@example.com',
            email: 'maya@example.com',
            full_name: 'Maya',
            user_image: null,
            enabled: true,
            is_admin: true,
            drive_bytes: 20e9,
            reserved_bytes: 0,
            mail_bytes: 30e9,
            combined_bytes: 50e9,
            cap_bytes: null,
            effective_cap_bytes: null,
            mail_fetched_at: null,
          },
          {
            name: 'leah@example.com',
            email: 'leah@example.com',
            full_name: 'Leah',
            user_image: null,
            enabled: true,
            is_admin: false,
            drive_bytes: 30e9,
            reserved_bytes: 0,
            mail_bytes: 15e9,
            combined_bytes: 45e9,
            cap_bytes: null,
            effective_cap_bytes: null,
            mail_fetched_at: null,
          },
        ],
        roots: [],
      })
    if (path === '/api/suite/users') {
      if (state.failUsers)
        return new Response(
          JSON.stringify({ errors: [{ type: 'PermissionError', message: 'User lookup failed' }] }),
          { status: 403 },
        )
      return json([
        {
          name: 'maya@example.com',
          email: 'maya@example.com',
          full_name: 'Maya',
          user_image: null,
          is_admin: true,
          enabled: true,
          account: 'maya@example.com',
          setup_status: 'Active',
          must_change_password: false,
        },
        {
          name: 'leah@example.com',
          email: 'leah@example.com',
          full_name: 'Leah',
          user_image: null,
          is_admin: false,
          enabled: true,
          account: 'leah@example.com',
          setup_status: 'Setup failed',
          must_change_password: false,
        },
      ])
    }
    if (path === '/api/suite/admin/health')
      return json({
        cloud: state.cloud,
        suspended: false,
        stale: false,
        fetched_at: null,
        alerts: ['DNS needs attention'],
      })
    if (path === '/api/method/suite.mail.api.admin.get_domains') {
      state.domainCalls++
      if (state.noDomains) return new Response(JSON.stringify({ message: { items: [], total: 0 } }))
      if (state.failDomains)
        return new Response(
          JSON.stringify({
            errors: [{ type: 'ValidationError', message: 'Directory unavailable' }],
          }),
          { status: 503 },
        )
      const nextPage = state.pagedDomains && JSON.parse(String(init.body || '{}')).start > 0
      return new Response(
        JSON.stringify({
          message: {
            items: [
              {
                id: nextPage ? 'ready.example.com' : 'example.com',
                name: nextPage ? 'ready.example.com' : 'example.com',
                description: '',
                status: nextPage ? 'Active' : 'Pending Verification',
                is_enabled: true,
                is_verified: nextPage,
                catch_all_address: '',
                sub_addressing: false,
                allow_relaying: false,
                last_verified_at: null,
                created_at: null,
              },
            ],
            total: state.pagedDomains ? 2 : 1,
          },
        }),
      )
    }
    return json({})
  }
  return state
})

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())
beforeEach(() => {
  server.cloud = true
  server.domainCalls = 0
  server.failDomains = false
  server.failUsers = false
  server.pagedDomains = false
  server.noDomains = false
})

async function mount(component: Component, props: Record<string, unknown> = {}) {
  if (component === OverviewView) {
    // Each scenario refreshes its independent server fixture through the same
    // public reader as the UI, rather than inheriting another test's fresh cache.
    await client.query(api.suite.storage.get)
    await client.query(api.suite.users.list).catch(() => {})
    if (server.cloud)
      await client.query(api.mail.admin.domains.list, { page_length: 500 }).catch(() => {})
  }
  const root = document.createElement('div')
  document.body.append(root)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push('/admin')
  const app = createApp({ render: () => h(component, props) })
  app.use(router).use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

function report(overrides: Partial<StorageGetOutput> = {}): StorageGetOutput {
  return {
    cloud: true,
    drive_bytes: 50e9,
    personal_drive_bytes: 40e9,
    shared_drive_bytes: 10e9,
    mail_bytes: 45e9,
    combined_bytes: 95e9,
    group_mail_bytes: 3e9,
    pending_invitations: 0,
    reserved_bytes: 2e9,
    allowance_bytes: 100e9,
    effective_allowance_bytes: 110e9,
    default_cap_bytes: null,
    stale: false,
    fetched_at: '2026-10-12T10:00:00Z',
    users: [],
    roots: [],
    ...overrides,
  }
}

describe('Admin overview', () => {
  it('keeps storage and DNS alerts beside their areas, with account setup failures left to Users', async () => {
    const root = await mount(OverviewView)
    await vi.waitFor(() =>
      expect(root.querySelector('section[aria-label="Domains"]')?.textContent).toContain(
        'Verify DNS records',
      ),
    )
    const storage = root.querySelector('section[aria-label="Site storage"]')
    expect(storage?.textContent).toContain('Storage is almost full')
    expect(storage?.textContent).not.toContain('DNS')
    expect(root.textContent).not.toContain('Mail account setup failed')
    const kpis = root.querySelector('[aria-label="Workspace summary"]')
    expect(kpis?.querySelectorAll('a')).toHaveLength(3)
    expect(kpis?.textContent).not.toContain('Storage used')
    expect(kpis?.textContent).not.toContain('admins')
    expect(kpis?.textContent).not.toContain('disabled')
    expect(kpis?.textContent).toContain('Pending invitations')
    expect(root.textContent).not.toContain('Largest Drive users')
    expect(root.textContent).not.toContain('Quick actions')
    expect(root.textContent).not.toContain('Refresh usage')
    expect(root.textContent).not.toContain('Updated')
    expect(root.textContent).not.toContain('Mail domains')
  })

  it('keeps standalone accounting Drive-only and never queries the domain provider', async () => {
    server.cloud = false
    const root = await mount(OverviewView)
    await vi.waitFor(() =>
      expect(root.querySelector('[aria-label="Workspace summary"]')?.textContent).toContain(
        'Active users',
      ),
    )
    expect(root.querySelector('section[aria-label="Domains"]')).toBeNull()
    expect(root.textContent).not.toContain('Pending invitations')
    expect(root.querySelector('section[aria-label="Site storage"]')?.textContent).not.toContain(
      'Mail',
    )
    expect(server.domainCalls).toBe(0)
    expect(
      root.querySelector('[aria-label="Workspace summary"]')?.querySelectorAll('a'),
    ).toHaveLength(1)
  })

  it('reports a failed domain check in the domain card, not in the storage card', async () => {
    server.failDomains = true
    const root = await mount(OverviewView)
    await vi.waitFor(() =>
      expect(root.querySelector('section[aria-label="Domains"]')?.textContent).toContain(
        'Domain status is unavailable',
      ),
    )
    expect(root.querySelector('section[aria-label="Site storage"]')?.textContent).not.toContain(
      'Domain',
    )
  })

  it('does not replace failed user counts with a fabricated zero', async () => {
    server.failUsers = true
    const root = await mount(OverviewView)
    await vi.waitFor(() => expect(root.textContent).toContain('Could not load users'))
    expect(root.querySelector('[aria-label="Workspace summary"] a')?.textContent).toContain('—')
    expect(root.querySelector('section[aria-label="Site storage"]')?.textContent).toContain(
      '95 GB of 100 GB used',
    )
  })

  it('counts ready domains beyond the first directory page', async () => {
    server.pagedDomains = true
    const root = await mount(OverviewView)
    await vi.waitFor(() =>
      expect(root.querySelector('[aria-label="Workspace summary"]')?.textContent).toContain('1/2'),
    )
    expect(root.querySelector('section[aria-label="Domains"]')?.textContent).toContain(
      'Verify DNS records',
    )
  })

  it('offers domain setup instead of a zero-out-of-zero count when no domain is set', async () => {
    server.noDomains = true
    const root = await mount(OverviewView)
    await vi.waitFor(() =>
      expect(root.querySelector('section[aria-label="Domains"]')?.textContent).toContain(
        'No domain set',
      ),
    )
    expect(root.querySelector('[aria-label="Workspace summary"]')?.textContent).toContain('Not set')
    expect(root.textContent).not.toContain('0/0')
    expect(
      root.querySelector('section[aria-label="Domains"] a[href="/admin/mail/domains?add=1"]'),
    ).not.toBeNull()
  })
})

describe('Site storage summary', () => {
  it('does not count reservations or group Mail a second time in stored usage', async () => {
    const root = await mount(SiteStorageSummary, { report: report() })
    expect(root.textContent).toContain('95 GB of 100 GB used')
    expect(root.textContent).toContain('In progress 2 GB')
    expect(root.textContent).not.toContain('97 GB of 100 GB used')
    expect(root.textContent).not.toContain('Reservations count')
  })

  it.each([
    { usage: 105e9, title: 'Extra storage is in use' },
    { usage: 111e9, title: 'Storage is full' },
  ])(
    'explains the site threshold at $usage bytes without claiming Mail stops',
    async ({ usage, title }) => {
      const root = await mount(SiteStorageSummary, {
        report: report({ combined_bytes: usage, mail_bytes: usage - 50e9 }),
      })
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(title)
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('Mail will keep working')
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('Free up space')
    },
  )

  it('shows unmeasured Mail and allowance as unavailable, not zero or uncapped', async () => {
    const root = await mount(SiteStorageSummary, {
      report: report({
        combined_bytes: null,
        mail_bytes: null,
        allowance_bytes: null,
        effective_allowance_bytes: null,
        fetched_at: null,
      }),
    })
    expect(root.textContent).toContain('Storage usage is unavailable')
    expect(root.textContent).toContain('Mail Unavailable')
    expect(root.textContent).toContain('Uploads are temporarily paused')
    expect(root.textContent).not.toContain('Refresh usage')
    expect(root.textContent).not.toContain('no limit')
  })

  it('keeps known usage visible without exposing refresh machinery or timestamps', async () => {
    const root = await mount(SiteStorageSummary, { report: report({ stale: true }) })
    expect(root.textContent).toContain('95 GB of 100 GB used')
    expect(root.textContent).not.toContain('Storage usage is out of date')
    expect(root.textContent).not.toContain('Refresh usage')
    expect(root.textContent).not.toContain('Updated')
    expect(root.textContent).not.toContain('2026')
  })

  it('preserves legitimate zero usage and an explicitly uncapped site', async () => {
    const root = await mount(SiteStorageSummary, {
      report: report({
        drive_bytes: 0,
        personal_drive_bytes: 0,
        shared_drive_bytes: 0,
        mail_bytes: 0,
        combined_bytes: 0,
        reserved_bytes: 0,
        allowance_bytes: 0,
        effective_allowance_bytes: null,
      }),
    })
    expect(root.textContent).toContain('0 GB used · no limit')
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.textContent).not.toContain('Unavailable')
  })
})
