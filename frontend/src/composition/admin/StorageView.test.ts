import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { api, client } from '@/api'
import { translationPlugin } from '@/platform/translation'

import StorageView from './StorageView.vue'

vi.mock('frappe-ui', async () => ({
  toast: { error: vi.fn() },
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

const requests = vi.hoisted((): RequestInit[] => [])
const state = vi.hoisted(() => ({ reads: 0, fail: false, partial: false }))
vi.hoisted(() => {
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') requests.push(init)
    const path = new URL(String(url), 'http://suite.test').pathname
    if (path === '/api/suite/storage') state.reads++
    if (path === '/api/suite/storage/limits' && state.fail)
      return new Response(JSON.stringify({ error: { message: 'Storage service unavailable' } }), {
        status: 500,
      })
    if (path === '/api/suite/storage' || path === '/api/suite/storage/default')
      return new Response(
        JSON.stringify({
          data: {
            cloud: true,
            drive_bytes: 101e9,
            personal_drive_bytes: 18e9,
            shared_drive_bytes: 83e9,
            group_mail_bytes: 0,
            pending_invitations: 0,
            reserved_bytes: 0,
            mail_bytes: 4e9,
            combined_bytes: 105e9,
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
    if (path === '/api/suite/storage/limits')
      return new Response(
        JSON.stringify({
          data: JSON.parse(String(init?.body)).users.map((user: string) => ({
            user,
            success: !(state.partial && user === 'leah@example.com'),
            error: state.partial && user === 'leah@example.com' ? 'Try again' : null,
          })),
        }),
      )
    return new Response(JSON.stringify({ data: {} }))
  }
})

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  requests.length = 0
  state.fail = false
  state.partial = false
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
  it('refuses invalid defaults visibly and preserves decimal byte conversion', async () => {
    await render()
    button('Default storage').click()
    await vi.waitFor(() => expect(document.querySelector('input[type="number"]')).not.toBeNull())
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!
    input.value = '0'
    input.stepDown()
    expect(input.value).toBe('0')
    for (const value of ['-1', '0']) {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      button('Save').click()
      await vi.waitFor(() =>
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
          'Enter a storage limit greater than zero',
        ),
      )
      expect(requests).toHaveLength(0)
    }
    input.value = '1.25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    button('Save').click()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(String(requests[0]?.body)).toContain('1250000000')
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    for (const [value, capBytes] of [
      ['', null],
      ['2', 2_000_000_000],
    ]) {
      requests.length = 0
      button('Default storage').click()
      await vi.waitFor(() => expect(document.querySelector('input[type="number"]')).not.toBeNull())
      const nextInput = document.querySelector<HTMLInputElement>('input[type="number"]')!
      nextInput.value = String(value)
      nextInput.dispatchEvent(new Event('input', { bubbles: true }))
      button('Save').click()
      await vi.waitFor(() => expect(requests).toHaveLength(1))
      expect(JSON.parse(String(requests[0]?.body))).toEqual({ cap_bytes: capBytes })
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    }
  })

  it('edits an individual combined quota and sends decimal GB without headroom', async () => {
    await render()
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Edit storage limit for Maya"]')!
      .click()
    await vi.waitFor(() => expect(document.querySelector('input[type="number"]')).not.toBeNull())
    button('Cancel').click()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Edit storage limit for Maya"]')!
      .click()
    await vi.waitFor(() => expect(document.querySelector('input[type="number"]')).not.toBeNull())
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!
    await vi.waitFor(() => expect(input.disabled).toBe(false))
    expect(input.value).toBe('10')
    for (const value of ['-1', '0']) {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      button('Save').click()
      await vi.waitFor(() =>
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
          'Enter a storage limit greater than zero.',
        ),
      )
      expect(requests).toHaveLength(0)
    }
    input.value = '12.5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(button('Save').disabled).toBe(false))

    const reads = state.reads
    const saveButton = button('Save')
    saveButton.click()
    saveButton.click()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      users: ['maya@example.com'],
      cap_bytes: 12500000000,
    })
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    await vi.waitFor(() => expect(state.reads).toBeGreaterThan(reads))
  })

  it('removes an individual cap with blank input', async () => {
    await render()
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Edit storage limit for Maya"]')!
      .click()
    await vi.waitFor(() => expect(document.querySelector('input[type="number"]')).not.toBeNull())
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(button('Save').disabled).toBe(false))
    button('Save').click()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      users: ['maya@example.com'],
      cap_bytes: null,
    })
  })

  it('shows each configured limit and offers no separate extra-storage actions', async () => {
    await render()
    expect(document.body.textContent).toContain('of 10 GB')
    expect(
      [...document.querySelectorAll('[role=columnheader]')].map((item) => item.textContent?.trim()),
    ).not.toContain('Limit')
    expect(document.body.textContent).not.toContain('110 GB')
    expect(document.body.textContent).not.toContain('Extra storage')
    expect(document.body.textContent).not.toContain('Using extra storage')
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
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!
    input.value = '20'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    button('Save').click()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      users: ['maya@example.com', 'leah@example.com'],
      cap_bytes: 20000000000,
    })
  })
  it('keeps failed saves open for retry', async () => {
    await render()
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Edit storage limit for Maya"]')!
      .click()
    await vi.waitFor(() => expect(document.querySelector('input[type="number"]')).not.toBeNull())
    await vi.waitFor(() => expect(button('Save').disabled).toBe(false))
    state.fail = true
    button('Save').click()
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'Storage service unavailable',
      ),
    )
    state.fail = false
    button('Save').click()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(requests).toHaveLength(2)
  })
  it('retries only failed bulk targets', async () => {
    await render()
    document.querySelector<HTMLElement>('[aria-label="Select all"]')!.click()
    await vi.waitFor(() => expect(button('Set limits').disabled).toBe(false))
    button('Set limits').click()
    await vi.waitFor(() => expect(document.querySelector('input[type="number"]')).not.toBeNull())
    await vi.waitFor(() => expect(button('Save').disabled).toBe(false))
    state.partial = true
    button('Save').click()
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Try again'),
    )
    state.partial = false
    button('Retry failed').click()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(JSON.parse(String(requests[1]?.body))).toEqual({
      users: ['leah@example.com'],
      cap_bytes: null,
    })
  })
})
