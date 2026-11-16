import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTransport, type Operation, type TransportError } from '@/platform/transport'

import { confirm, failureText, hostChallenge, prompt, reportMutationError } from './index'

const PROBE: Operation = {
  id: 'probe',
  owner: 'test',
  method: 'POST',
  path: 'probe',
  kind: 'mutation',
}

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  danger: vi.fn(),
  prompt: vi.fn(),
  error: vi.fn(),
}))

vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  return {
    FrappeUIProvider: defineComponent({ template: '<slot />' }),
    dialog: { confirm: mocks.confirm, danger: mocks.danger, prompt: mocks.prompt },
    toast: { error: mocks.error },
  }
})

beforeEach(() => vi.clearAllMocks())

describe('feedback', () => {
  it('turns confirm callbacks into a boolean result', async () => {
    mocks.confirm.mockImplementationOnce((options) => options.onConfirm())
    await expect(confirm({ title: 'Continue?' })).resolves.toBe(true)
    mocks.danger.mockImplementationOnce((options) => options.onCancel())
    await expect(confirm({ title: 'Delete?', destructive: true })).resolves.toBe(false)
  })

  it('returns prompt values and reports mutation errors as toasts', async () => {
    mocks.prompt.mockImplementationOnce((options) =>
      options.onConfirm({ values: { password: 'secret' } }),
    )
    await expect(
      prompt({ title: 'Unlock', fields: [{ name: 'password', type: 'text' }] }),
    ).resolves.toEqual({ password: 'secret' })
    reportMutationError({ type: 'DriveLocked', message: 'Locked', status: 403, fromServer: true })
    expect(mocks.error).toHaveBeenCalledWith('Locked')
  })

  it('reports an engine refusal once when its workflow also handles it, and ignores cancellation', () => {
    const refusal = new Error('Permission denied')
    reportMutationError(refusal)
    reportMutationError(refusal)
    reportMutationError(new DOMException('Canceled', 'AbortError'))
    expect(mocks.error.mock.calls).toEqual([['Permission denied']])
  })

  it('hosts a challenge, resolves its prompt, and retries the failed action', async () => {
    mocks.prompt.mockImplementationOnce((options) =>
      options.onConfirm({ values: { password: 'open' } }),
    )
    let registered: ((error: any, retry: () => Promise<unknown>) => Promise<unknown>) | undefined
    const cleanup = vi.fn()
    const state = {
      onChallenge: vi.fn((_type, handler) => {
        registered = handler
        return cleanup
      }),
    }
    const resolve = vi.fn()
    const remove = hostChallenge(state, 'DriveLocked', {
      title: 'Unlock link',
      message: (error) => `Unlock ${error.link}`,
      fields: [{ name: 'password', type: 'text' }],
      resolve,
    })
    const retry = vi.fn(async () => 'retried')
    await expect(
      registered?.({ type: 'DriveLocked', message: 'Locked', status: 403, link: 'link-1' }, retry),
    ).resolves.toBe('retried')
    expect(resolve).toHaveBeenCalledWith(
      { password: 'open' },
      expect.objectContaining({ link: 'link-1' }),
    )
    expect(retry).toHaveBeenCalledOnce()
    remove()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('does not retry a challenge when the prompt is cancelled', async () => {
    mocks.prompt.mockImplementationOnce((options) => options.onCancel())
    let registered: ((error: any, retry: () => Promise<unknown>) => Promise<unknown>) | undefined
    const state = {
      onChallenge: vi.fn((_type, handler) => {
        registered = handler
        return () => {}
      }),
    }
    const resolve = vi.fn()
    hostChallenge(state, 'DriveLocked', {
      title: 'Unlock link',
      fields: [{ name: 'password', type: 'text' }],
      resolve,
    })
    const retry = vi.fn()
    await registered?.({ type: 'DriveLocked', message: 'Locked', status: 403 }, retry)
    expect(resolve).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
  })

  describe('failureText', () => {
    // Real failures from the real transport, so what the server sends decides the text.
    const failWith = (fetch: typeof globalThis.fetch) =>
      createTransport({ fetch })
        .request(PROBE, {})
        .then(
          () => 'request did not fail',
          (error: TransportError) => failureText(error),
        )
    const answer = (body: unknown, status: number) => async () =>
      new Response(JSON.stringify(body), { status })

    it("shows the reason the server wrote, and hides a bare status it didn't", async () => {
      const reason = JSON.stringify([JSON.stringify({ message: 'Guests are not allowed' })])
      await expect(failWith(answer({ _server_messages: reason }, 417))).resolves.toBe(
        'Guests are not allowed',
      )
      await expect(failWith(answer({}, 403))).resolves.toBe(
        'Could not complete the request. Try again.',
      )
    })

    it('puts a crashed server in plain words, not its traceback', async () => {
      await expect(
        failWith(answer({ message: 'Traceback (most recent call last)' }, 500)),
      ).resolves.toBe('The server had a problem. Try again in a moment.')
    })

    it('puts a network failure in plain words, not the browser text', async () => {
      await expect(
        failWith(async () => {
          throw new TypeError('Failed to fetch')
        }),
      ).resolves.toBe("Couldn't reach the server. Check your connection and try again.")
    })
  })
})
