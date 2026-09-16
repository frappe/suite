import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTransport, TransportError, type Operation } from './index'

const getNode: Operation<{ node: string; expand?: string[] }, { name: string }> = {
  id: 'node_get',
  owner: 'drive',
  method: 'GET',
  path: 'nodes/{node}',
  pathParams: ['node'],
  nodeParams: ['node'],
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

afterEach(() => {
  vi.useRealTimers()
  window.csrf_token = undefined
})

describe('transport', () => {
  it('builds Suite URLs, adds CSRF and link headers, and decodes v2 success', async () => {
    window.csrf_token = 'csrf'
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: { name: 'n1' } }))
    const client = createTransport({
      fetch: fetcher,
      linkStore: { codesFor: () => Array.from({ length: 24 }, (_, index) => `c${index}`) },
    })

    await expect(client.request(getNode, { node: 'n1', expand: ['breadcrumbs'] })).resolves.toEqual({
      name: 'n1',
    })
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/suite/drive/nodes/n1?expand=%5B%22breadcrumbs%22%5D')
    expect(new Headers(init?.headers).get('X-Frappe-CSRF-Token')).toBe('csrf')
    expect(new Headers(init?.headers).get('X-Drive-Links')?.split(',')).toHaveLength(20)
  })

  it('classifies errors by errors[0].type instead of status', async () => {
    const client = createTransport({
      fetch: async () => response({ errors: [{ type: 'DriveConflict', message: 'Changed' }] }, 417),
    })

    await expect(client.request(getNode, { node: 'n1' })).rejects.toMatchObject({
      type: 'DriveConflict',
      message: 'Changed',
      status: 417,
    } satisfies Partial<TransportError>)
  })

  it('retries GET network, 5xx, and 429 failures but never writes', async () => {
    const getFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response({ errors: [{ type: 'Busy', message: 'Busy' }] }, 503))
      .mockResolvedValueOnce(response({ errors: [{ type: 'RateLimitExceededError', message: 'Wait' }] }, 429, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(response({ data: { name: 'n1' } }))
    const client = createTransport({ fetch: getFetch, maxRetries: 3, retryBaseMs: 0 })
    await expect(client.request(getNode, { node: 'n1' })).resolves.toEqual({ name: 'n1' })
    expect(getFetch).toHaveBeenCalledTimes(4)

    const write: Operation<{ title: string }, unknown> = {
      id: 'rename', owner: 'drive', method: 'PATCH', path: 'nodes/n1',
    }
    const writeFetch = vi.fn(async () => response({ errors: [{ type: 'Busy', message: 'Busy' }] }, 503))
    await expect(createTransport({ fetch: writeFetch }).request(write, { title: 'Next' })).rejects.toBeInstanceOf(TransportError)
    expect(writeFetch).toHaveBeenCalledOnce()
  })

  it('waits for Retry-After before retrying a rate-limited GET', async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(
        { errors: [{ type: 'RateLimitExceededError', message: 'Wait' }] },
        429,
        { 'Retry-After': '2' },
      ))
      .mockResolvedValueOnce(response({ data: { name: 'n1' } }))
    const pending = createTransport({ fetch: fetcher, maxRetries: 1, retryBaseMs: 1 })
      .request(getNode, { node: 'n1' })

    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetcher).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual({ name: 'n1' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not retry ordinary 4xx errors', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({ errors: [{ type: 'DriveForbidden', message: 'No access' }] }, 403),
    )
    const client = createTransport({ fetch: fetcher, maxRetries: 3, retryBaseMs: 0 })
    await expect(client.request(getNode, { node: 'n1' })).rejects.toMatchObject({
      type: 'DriveForbidden',
      status: 403,
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('reports SessionExpired once and preserves typed error details', async () => {
    const expired = vi.fn()
    const fetcher = vi.fn<typeof fetch>(async () => response({
      errors: [{ type: 'SessionExpired', message: 'Sign in again', redirect: '/login' }],
    }, 401))
    const client = createTransport({ fetch: fetcher, onSessionExpired: expired })

    const failure = await client.request(getNode, { node: 'n1' }).catch((error) => error)
    expect(failure).toBeInstanceOf(TransportError)
    expect(failure).toMatchObject({
      name: 'TransportError', type: 'SessionExpired', message: 'Sign in again', status: 401,
      details: { redirect: '/login' },
    })
    expect(expired).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('deduplicates link codes before enforcing the twenty-code cap', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: { name: 'n1' } }))
    const codes = ['same', 'same', ...Array.from({ length: 24 }, (_, index) => `c${index}`)]
    const client = createTransport({ fetch: fetcher, linkStore: { codesFor: () => codes } })
    await client.request(getNode, { node: 'n1' })
    const header = new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('X-Drive-Links')
    expect(header?.split(',')).toEqual(['same', ...Array.from({ length: 19 }, (_, index) => `c${index}`)])
  })

  it('passes AbortSignal through without converting AbortError', async () => {
    const client = createTransport({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    })
    const controller = new AbortController()
    const pending = client.request(getNode, { node: 'n1' }, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
