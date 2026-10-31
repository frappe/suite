import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import { createApiClient, installApiErrorHandler } from '@/platform/server-state'
import { createTransport } from '@/platform/transport'

import RenameDialog from './RenameDialog.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/FormControl')),
}))

const mocks = vi.hoisted(() => ({ useMutation: vi.fn<typeof import('@/api').useMutation>() }))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useMutation: mocks.useMutation,
}))

const report = { name: 'n1', title: 'Quarterly report.pdf', kind: 'file' } as DriveNode

let cleanup: (() => void) | undefined
let engine: ReturnType<typeof createApiClient>
const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
const diagnostics = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  fetcher.mockReset()
  engine = createApiClient(
    { drive: () => import('@/apps/drive/client/policy').then((module) => module.registration) },
    { transport: createTransport({ fetch: fetcher }), persistence: false, feedback },
  )
  mocks.useMutation.mockImplementation(engine.useMutation)
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  engine.dispose()
})

async function openRename(node: DriveNode) {
  const root = document.createElement('div')
  document.body.append(root)
  const open = ref(true)
  const renamed = vi.fn()
  const app = createApp({
    setup: () => () =>
      h(RenameDialog, {
        node,
        open: open.value,
        'onUpdate:open': (value: boolean) => (open.value = value),
        onRenamed: renamed,
      }),
  })
  app.config.errorHandler = diagnostics
  installApiErrorHandler(app)
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const input = await vi.waitFor(() => {
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input')
    expect(field && document.activeElement === field).toBe(true)
    return field!
  })
  return { input, open, renamed }
}

/** The text the field has selected. */
const selected = (input: HTMLInputElement) =>
  input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)

/** Focus leaves the field and comes back, as when a closing menu refocuses its trigger and the dialog takes focus back. */
async function refocus(input: HTMLInputElement) {
  input.blur()
  input.focus()
  input.select()
  await Promise.resolve()
}

describe('Rename dialog', () => {
  it('selects the name without its extension, even when focus leaves and comes back before the user starts', async () => {
    const { input } = await openRename(report)
    expect(selected(input)).toBe('Quarterly report')

    // However late the menu hands focus back.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await refocus(input)
    expect(selected(input)).toBe('Quarterly report')
  })

  it('leaves the selection to the user once they type in the field', async () => {
    const { input } = await openRename(report)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))

    await refocus(input)
    expect(selected(input)).toBe('Quarterly report.pdf')
  })

  it('keeps a refused draft open, clears stale feedback on reopen, and closes only after a successful retry', async () => {
    let answer: (response: Response) => void = () => {}
    fetcher.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { input, open, renamed } = await openRename(report)
    input.value = 'Taken.pdf'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const submit = () =>
      document
        .querySelector('[role="dialog"] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    submit()
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
        true,
      ),
    )
    answer(
      new Response(
        JSON.stringify({ errors: [{ type: 'DriveConflict', message: 'That title is taken' }] }),
        { status: 409 },
      ),
    )
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'That title is taken',
      ),
    )
    expect(open.value).toBe(true)
    expect(input.value).toBe('Taken.pdf')
    expect(renamed).not.toHaveBeenCalled()
    expect(feedback).not.toHaveBeenCalled()
    expect(diagnostics).not.toHaveBeenCalled()

    open.value = false
    await nextTick()
    open.value = true
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
        'That title is taken',
      ),
    )
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
    field.value = 'Forecast.pdf'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            ...report,
            title: 'Forecast.pdf',
            parent_node: 'root',
            root: 'root',
            state: 'Active',
            trash_root: null,
            size: 0,
            mime: 'application/pdf',
            url: null,
            content_doctype: null,
            content_docname: null,
            is_template: 0,
            owner: { id: 'alice', full_name: 'Alice', user_image: null },
            creation: null,
            modified: null,
            content_modified: null,
          },
        }),
      ),
    )
    submit()
    await vi.waitFor(() => expect(renamed).toHaveBeenCalledOnce())
    expect(open.value).toBe(false)
    expect(renamed.mock.calls[0]?.[0].title).toBe('Forecast.pdf')
  })
})
