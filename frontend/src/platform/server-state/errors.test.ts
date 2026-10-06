/* eslint-disable vue/one-component-per-file -- Fixtures exercise nested events and Dialog actions. */
import { Dialog } from 'frappe-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import {
  createTransport,
  TransportError,
  type MutationRef,
  type TransferRef,
} from '@/platform/transport'

import { createApiClient, installApiErrorHandler } from './index'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/components/Dialog')),
}))

const command: MutationRef<Record<never, never>, string> = {
  owner: 'test',
  id: 'save',
  kind: 'mutation',
  method: 'POST',
  path: '/save',
}
const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
const report = vi.fn()
let engine: ReturnType<typeof createApiClient>
let unmount: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  engine = createApiClient(
    {
      test: async () => ({
        policy: () => ({ effects: 'none' }),
        transfer: async () => {
          throw new TransportError({ type: 'Quota', message: 'Storage is full', status: 413 })
        },
      }),
    },
    { transport: createTransport({ fetch: fetcher, maxRetries: 0 }), persistence: false, feedback },
  )
})
afterEach(() => {
  unmount?.()
  unmount = undefined
  engine.dispose()
  vi.restoreAllMocks()
})

function click(run: () => Promise<unknown>, withReporter = true) {
  const Child = defineComponent({
    emits: ['submit'],
    setup:
      (_, { emit }) =>
      () =>
        h('button', { onClick: () => emit('submit') }, 'Save'),
  })
  const app = createApp({ render: () => h(Child, { onSubmit: run }) })
  if (withReporter) app.config.errorHandler = report
  installApiErrorHandler(app)
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  root.querySelector('button')!.click()
}

function refuse(status = 409) {
  fetcher.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          errors: [{ type: 'Conflict', message: 'That title is taken' }],
        }),
        { status },
      ),
  )
}

describe('Vue API error handling', () => {
  it.each([false, true])(
    'keeps a failed event pending state and success UI correct (silent: %s)',
    async (silent) => {
      refuse()
      const mutation = engine.useMutation(command, { silent })
      const success = vi.fn()
      click(async () => {
        await mutation.run({})
        success()
      })
      expect(mutation.isPending).toBe(true)
      await vi.waitFor(() => expect(mutation.error?.message).toBe('That title is taken'))
      expect(mutation.isPending).toBe(false)
      expect(success).not.toHaveBeenCalled()
      expect(feedback).toHaveBeenCalledTimes(silent ? 0 : 1)
      expect(report).not.toHaveBeenCalled()

      fetcher.mockImplementation(async () => new Response(JSON.stringify({ data: 'saved' })))
      document.querySelector('button')!.click()
      await vi.waitFor(() => expect(success).toHaveBeenCalledOnce())
      expect(mutation.error).toBeNull()
      expect(mutation.isPending).toBe(false)
    },
  )

  it('preserves rejection for imperative callers', async () => {
    refuse()
    await expect(engine.client.mutation(command, {})).rejects.toBeInstanceOf(TransportError)
    expect(feedback).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'handles transfer feedback without consuming rejection (silent: %s)',
    async (silent) => {
      const reference: TransferRef<{ file: Blob }, string> = {
        kind: 'transfer',
        owner: 'test',
        id: 'upload',
      }
      const upload = engine.useUpload(reference, { silent })
      const success = vi.fn()
      click(async () => {
        await upload.run({ file: new Blob(['file']) })
        success()
      })
      await vi.waitFor(() => expect(upload.error?.message).toBe('Storage is full'))
      expect(upload.isPending).toBe(false)
      expect(success).not.toHaveBeenCalled()
      expect(feedback).toHaveBeenCalledTimes(silent ? 0 : 1)
      expect(report).not.toHaveBeenCalled()
    },
  )

  it('handles a frappe-ui Dialog action without closing on refusal and resets its loading state', async () => {
    refuse()
    const close = vi.fn()
    const app = createApp({
      render: () =>
        h(Dialog, {
          open: true,
          title: 'Save',
          'onUpdate:open': close,
          actions: [
            {
              label: 'Save',
              onClick: async ({ close }) => {
                await engine.client.mutation(command, {})
                close()
              },
            },
          ],
        }),
    })
    app.config.errorHandler = report
    installApiErrorHandler(app)
    const root = document.createElement('div')
    document.body.append(root)
    app.mount(root)
    unmount = () => {
      app.unmount()
      root.remove()
    }
    const save = await vi.waitFor(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ].find((button) => button.textContent?.trim() === 'Save')
      expect(button).toBeDefined()
      return button!
    })
    save.click()
    await vi.waitFor(() => expect(feedback).toHaveBeenCalledOnce())
    expect(close).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(save.disabled).toBe(false))

    fetcher.mockImplementation(async () => new Response(JSON.stringify({ data: 'saved' })))
    save.click()
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(false))
  })

  it('ignores event cancellation without recording an inline refusal or feedback', async () => {
    fetcher.mockRejectedValue(new DOMException('Canceled', 'AbortError'))
    const mutation = engine.useMutation(command)
    const success = vi.fn()
    click(async () => {
      await mutation.run({})
      success()
    })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(mutation.isPending).toBe(false))
    expect(mutation.error).toBeNull()
    expect(success).not.toHaveBeenCalled()
    expect(feedback).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('reports unhandled reads, broken writes, and server faults to the existing handler', async () => {
    refuse()
    click(() => engine.client.query({ ...command, kind: 'query', method: 'GET' }, {}))
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce())
    expect(report.mock.calls[0]?.[0]).toBeInstanceOf(TransportError)
    expect(feedback).not.toHaveBeenCalled()

    const broken = new TypeError('Invalid response contract')
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ data: 'saved' })))
    unmount?.()
    click(() =>
      engine.client.mutation(
        {
          ...command,
          validateOutput() {
            throw broken
          },
        },
        {},
      ),
    )
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(2))
    expect(report.mock.calls[1]?.[0]).toBe(broken)

    unmount?.()
    click(async () => {
      await engine.client.mutation(command, {})
      throw broken
    })
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(3))
    expect(report.mock.calls[2]?.[0]).toBe(broken)

    refuse(500)
    unmount?.()
    click(() => engine.client.mutation(command, {}))
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(4))
    expect(report.mock.calls[3]?.[0]).toMatchObject({ status: 500 })
  })

  it('reports unexpected errors to the console when tracking is unconfigured', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = new TypeError('Broken event')
    click(async () => {
      throw broken
    }, false)
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(broken))
  })
})
