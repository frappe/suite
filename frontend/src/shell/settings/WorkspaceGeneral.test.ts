import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, type Slots } from 'vue'

import { translationPlugin } from '@/platform/translation'

import WorkspaceGeneral from './WorkspaceGeneral.vue'

const server = vi.hoisted(() => {
  window.suite_workspace_name = 'Northwind'
  window.suite_workspace_logo = '/files/northwind.png'
  const writes: unknown[] = []
  const state = { writes }
  globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(url), 'http://suite.test').pathname
    if (path === '/api/suite/site' && init.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      state.writes.push(body)
      return new Response(
        JSON.stringify({ data: { is_onboarded: true, can_onboard: true, ...body } }),
      )
    }
    throw new Error(`Unexpected request: ${init.method ?? 'GET'} ${path}`)
  }
  return state
})

vi.mock('frappe-ui', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  // The real uploader needs a file dialog; only its slot matters here.
  FileUploader: {
    setup:
      (_: unknown, { slots }: { slots: Slots }) =>
      () =>
        slots.default?.({ openFileSelector: () => {} }),
  },
}))

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

it('removes the workspace logo with the × and saves the change', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(WorkspaceGeneral) })
  app.use(translationPlugin)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }

  expect(root.querySelector('img')?.getAttribute('src')).toBe('/files/northwind.png')
  root.querySelector<HTMLButtonElement>('button[aria-label="Remove logo"]')!.click()

  await vi.waitFor(() =>
    expect(server.writes).toEqual([{ workspace_name: 'Northwind', workspace_logo: '' }]),
  )
  expect(root.querySelector('img')).toBeNull()
  expect(root.querySelector('button[aria-label="Upload logo"]')).not.toBeNull()
})
