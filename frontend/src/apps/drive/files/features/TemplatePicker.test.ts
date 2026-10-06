import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import { DOCUMENT_TYPES_KEY } from '@/platform/contracts'
import { createApiClient, installApiErrorHandler } from '@/platform/server-state'
import { createTransport } from '@/platform/transport'

import TemplatePicker from './TemplatePicker.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/FormControl')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Skeleton')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/TabButtons')),
}))
const mocks = vi.hoisted(() => ({
  useMutation: vi.fn<typeof import('@/api').useMutation>(),
  useInfiniteQuery: vi.fn<typeof import('@/api').useInfiniteQuery>(),
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useMutation: mocks.useMutation,
  useInfiniteQuery: mocks.useInfiniteQuery,
}))

const template: DriveNode = {
  name: 'template',
  title: 'Meeting notes',
  kind: 'document',
  parent_node: 'root',
  root: 'root',
  state: 'Active',
  trash_root: null,
  size: 0,
  mime: null,
  url: null,
  content_doctype: 'Writer Document',
  content_docname: 'notes',
  is_template: 1,
  owner: { id: 'alice', full_name: 'Alice', user_image: null },
  creation: null,
  modified: null,
  content_modified: null,
}
const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
const diagnostics = vi.fn()
let engine: ReturnType<typeof createApiClient>
let unmount: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  fetcher.mockReset()
  engine = createApiClient(
    { drive: () => import('@/apps/drive/client/policy').then((module) => module.registration) },
    { transport: createTransport({ fetch: fetcher }), persistence: false, feedback },
  )
  mocks.useMutation.mockImplementation(engine.useMutation)
  mocks.useInfiniteQuery.mockImplementation(engine.useInfiniteQuery)
})
afterEach(() => {
  unmount?.()
  engine.dispose()
})

describe('Template picker', () => {
  it('owns a refused double-click, retains the selection, and closes only after a successful retry', async () => {
    let answer: (response: Response) => void = () => {}
    fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === 'POST')
        return new Promise<Response>((resolve) => {
          answer = resolve
        })
      return new Response(JSON.stringify({ data: { rows: [template], next_cursor: null } }))
    })
    const open = ref(true)
    const created = vi.fn()
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp({
      render: () =>
        h(TemplatePicker, {
          parent: 'root',
          open: open.value,
          'onUpdate:open': (value: boolean) => {
            open.value = value
          },
          onCreated: created,
        }),
    })
    app.provide(DOCUMENT_TYPES_KEY, [
      {
        key: 'writer',
        contentDoctype: 'Writer Document',
        newLabel: () => 'Document',
        icon: {},
        loadSurface: async () => ({}),
      },
    ])
    app.config.errorHandler = diagnostics
    installApiErrorHandler(app)
    app.mount(root)
    unmount = () => {
      app.unmount()
      root.remove()
    }
    const option = await vi.waitFor(() => {
      const option = document.querySelector<HTMLButtonElement>('[role="option"]')
      expect(option?.textContent).toContain('Meeting notes')
      return option!
    })
    option.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
        1,
      ),
    )
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
        true,
      ),
    )
    answer(
      new Response(
        JSON.stringify({
          errors: [{ type: 'DrivePermissionError', message: 'You cannot copy this template' }],
        }),
        { status: 403 },
      ),
    )
    await vi.waitFor(() => expect(feedback).toHaveBeenCalledOnce())
    expect(open.value).toBe(true)
    expect(option.getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value).toBe(
      'Meeting notes',
    )
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
    expect(created).not.toHaveBeenCalled()
    expect(diagnostics).not.toHaveBeenCalled()

    document
      .querySelector('[role="dialog"] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
        2,
      ),
    )
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
        true,
      ),
    )
    expect(open.value).toBe(true)
    answer(new Response(JSON.stringify({ data: { ...template, name: 'copy', is_template: 0 } })))
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce())
    expect(open.value).toBe(false)
    expect(created.mock.calls[0]?.[0].name).toBe('copy')
    expect(feedback).toHaveBeenCalledOnce()
    expect(diagnostics).not.toHaveBeenCalled()
  })
})
