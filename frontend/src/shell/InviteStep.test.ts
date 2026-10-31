import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import { createApiClient, installApiErrorHandler } from '@/platform/server-state'
import { translate, translationPlugin } from '@/platform/translation'
import { createTransport } from '@/platform/transport'

import InviteStep from './InviteStep.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../node_modules/frappe-ui/src/components/FormControl')),
  ...(await import('../../../node_modules/frappe-ui/src/components/ErrorMessage')),
}))
const mocks = vi.hoisted(() => ({ useMutation: vi.fn<typeof import('@/api').useMutation>() }))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useMutation: mocks.useMutation,
}))
const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
const diagnostics = vi.fn()
let engine: ReturnType<typeof createApiClient>
let unmount: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('__', translate)
  engine = createApiClient(
    { suite: () => import('@/platform/transport/policy').then((m) => m.registration) },
    { transport: createTransport({ fetch: fetcher, maxRetries: 0 }), persistence: false, feedback },
  )
  mocks.useMutation.mockImplementation(engine.useMutation)
})
afterEach(() => {
  unmount?.()
  engine.dispose()
  vi.unstubAllGlobals()
})
it('keeps an invite draft after refusal and sends its success event only after a retry', async () => {
  let respond: (response: Response) => void = () => {}
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        respond = resolve
      }),
  )
  const sent = vi.fn()
  const app = createApp({
    render: () => h(InviteStep, { prefill: 'alice@example.test', onSent: sent }),
  })
  app.use(translationPlugin)
  app.config.errorHandler = diagnostics
  installApiErrorHandler(app)
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  const input = root.querySelector('textarea')!
  const submit = () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  submit()
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  await nextTick()
  expect(input.disabled).toBe(true)
  respond(
    new Response(
      JSON.stringify({
        errors: [{ type: 'OutgoingEmailError', message: 'Outgoing email unavailable' }],
      }),
      { status: 400 },
    ),
  )
  await vi.waitFor(() => expect(root.textContent).toContain('Outgoing email account not set up.'))
  expect(input.disabled).toBe(false)
  expect(input.value).toBe('alice@example.test')
  expect(sent).not.toHaveBeenCalled()
  expect(feedback).not.toHaveBeenCalled()
  expect(diagnostics).not.toHaveBeenCalled()
  fetcher.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            disabled_user_emails: [],
            accepted_invite_emails: [],
            pending_invite_emails: [],
            invited_emails: ['alice@example.test'],
          },
        }),
      ),
  )
  submit()
  await vi.waitFor(() => expect(sent).toHaveBeenCalledWith("We'll send 1 invite"))
  expect(input.value).toBe('')
  expect(input.disabled).toBe(false)
  expect(root.textContent).not.toContain('Outgoing email account not set up.')
})
