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
  it('sends a Blob field as the raw body, with the other fields in the query', async () => {
    const chunk: Operation<
      { upload_id: string; offset: number; chunk: Blob },
      { received: number }
    > = {
      id: 'upload_chunk',
      owner: 'drive',
      method: 'PUT',
      path: 'uploads/{upload_id}/chunk',
      pathParams: ['upload_id'],
      body: 'chunk',
    }
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: { received: 3 } }))
    const client = createTransport({ fetch: fetcher })
    const bytes = new Blob([new Uint8Array([1, 2, 3])])

    await expect(
      client.request(chunk, { upload_id: 'u1', offset: 0, chunk: bytes }),
    ).resolves.toEqual({ received: 3 })
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/suite/drive/uploads/u1/chunk?offset=0')
    expect(init?.body).toBe(bytes)
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/octet-stream')

    await expect(
      client.request(chunk, { upload_id: 'u1', offset: 0, chunk: 'not bytes' as unknown as Blob }),
    ).rejects.toThrow(TypeError)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('builds Suite URLs, adds CSRF, and decodes v2 success', async () => {
    window.csrf_token = 'csrf'
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: { name: 'n1' } }))
    const client = createTransport({ fetch: fetcher })

    await expect(client.request(getNode, { node: 'n1', expand: ['breadcrumbs'] })).resolves.toEqual(
      {
        name: 'n1',
      },
    )
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/suite/drive/nodes/n1?expand=%5B%22breadcrumbs%22%5D')
    expect(new Headers(init?.headers).get('X-Frappe-CSRF-Token')).toBe('csrf')
    expect(new Headers(init?.headers).has('X-Drive-Links')).toBe(false)
  })

  it('sends and returns binary bodies byte for byte, with the same headers, whatever the status', async () => {
    window.csrf_token = 'csrf'
    const sent = new Uint8Array([0, 255, 128, 10, 13, 0])
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array([255, 0, 1]), { status: 409 }),
    )
    const client = createTransport({ fetch: fetcher })
    const push: Operation = { ...getNode, method: 'POST', path: 'nodes/{node}/bytes' }

    const answer = await client.requestBytes(
      push,
      { node: 'n1' },
      { body: sent, keepalive: true, headers: { 'X-Drive-Links': 'c1' } },
    )

    expect([answer.status, [...answer.bytes]]).toEqual([409, [255, 0, 1]])
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/suite/drive/nodes/n1/bytes')
    expect([...new Uint8Array(await new Response(init?.body).arrayBuffer())]).toEqual([...sent])
    expect(init?.keepalive).toBe(true)
    const headers = new Headers(init?.headers)
    expect([
      headers.get('Content-Type'),
      headers.get('X-Frappe-CSRF-Token'),
      headers.get('X-Drive-Links'),
    ]).toEqual(['application/octet-stream', 'csrf', 'c1'])
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
      .mockResolvedValueOnce(
        response({ errors: [{ type: 'RateLimitExceededError', message: 'Wait' }] }, 429, {
          'Retry-After': '0',
        }),
      )
      .mockResolvedValueOnce(response({ data: { name: 'n1' } }))
    const client = createTransport({ fetch: getFetch, maxRetries: 3, retryBaseMs: 0 })
    await expect(client.request(getNode, { node: 'n1' })).resolves.toEqual({ name: 'n1' })
    expect(getFetch).toHaveBeenCalledTimes(4)

    const write: Operation<{ title: string }, unknown> = {
      id: 'rename',
      owner: 'drive',
      method: 'PATCH',
      path: 'nodes/n1',
    }
    const writeFetch = vi.fn(async () =>
      response({ errors: [{ type: 'Busy', message: 'Busy' }] }, 503),
    )
    await expect(
      createTransport({ fetch: writeFetch }).request(write, { title: 'Next' }),
    ).rejects.toBeInstanceOf(TransportError)
    expect(writeFetch).toHaveBeenCalledOnce()
  })

  it('waits for Retry-After before retrying a rate-limited GET', async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ errors: [{ type: 'RateLimitExceededError', message: 'Wait' }] }, 429, {
          'Retry-After': '2',
        }),
      )
      .mockResolvedValueOnce(response({ data: { name: 'n1' } }))
    const pending = createTransport({ fetch: fetcher, maxRetries: 1, retryBaseMs: 1 }).request(
      getNode,
      { node: 'n1' },
    )

    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetcher).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual({ name: 'n1' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('tells a refused write how long Retry-After asks it to wait', async () => {
    const unlock: Operation<{ password: string }, unknown> = {
      id: 'link_unlock',
      owner: 'drive',
      method: 'POST',
      path: 'links/t/unlock',
    }
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({ errors: [{ type: 'RateLimitExceededError', message: 'Wait' }] }, 429, {
        'Retry-After': '872',
      }),
    )
    const failure = await createTransport({ fetch: fetcher })
      .request(unlock, { password: 'x' })
      .catch((error) => error)
    expect(failure).toMatchObject({ status: 429, retryAfterMs: 872_000 })
    expect(fetcher).toHaveBeenCalledOnce()
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
    const fetcher = vi.fn<typeof fetch>(async () =>
      response(
        {
          errors: [{ type: 'SessionExpired', message: 'Sign in again', redirect: '/login' }],
        },
        401,
      ),
    )
    const client = createTransport({ fetch: fetcher, onSessionExpired: expired })

    const failure = await client.request(getNode, { node: 'n1' }).catch((error) => error)
    expect(failure).toBeInstanceOf(TransportError)
    expect(failure).toMatchObject({
      name: 'TransportError',
      type: 'SessionExpired',
      message: 'Sign in again',
      status: 401,
      details: { redirect: '/login' },
    })
    expect(expired).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('sends the link header the caller gives, unchanged, and no other', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: { name: 'n1' } }))
    const client = createTransport({ fetch: fetcher })
    const given = Array.from({ length: 24 }, (_, index) => `c${index}`).join(',')

    await client.request(getNode, { node: 'n1' }, { headers: { 'X-Drive-Links': given } })
    await client.request(
      { ...getNode, scope: () => ({ headers: { 'X-Drive-Links': 'scoped' } }) },
      { node: 'n1' },
    )

    const sent = fetcher.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('X-Drive-Links'),
    )
    expect(sent).toEqual([given, 'scoped'])
  })

  it('tells an operation scope the final outcome once, after retries', async () => {
    const outcomes: unknown[] = []
    const scoped: Operation<{ node: string }, { name: string }> = {
      ...getNode,
      scope: () => ({ settled: (outcome) => outcomes.push(outcome) }),
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ errors: [{ type: 'Busy', message: 'Busy' }] }, 503))
      .mockResolvedValueOnce(response({ data: { name: 'n1' } }))
      .mockResolvedValueOnce(
        response({ errors: [{ type: 'DriveLinkExpired', message: 'Expired' }] }, 410),
      )
    const client = createTransport({ fetch: fetcher, maxRetries: 1, retryBaseMs: 0 })

    await client.request(scoped, { node: 'n1' })
    await client.request(scoped, { node: 'n1' }).catch(() => {})

    expect(outcomes).toMatchObject([
      { ok: true, output: { name: 'n1' } },
      { ok: false, error: { type: 'DriveLinkExpired', status: 410 } },
    ])
  })

  it('sends nothing when an operation scope refuses the request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: { name: 'n1' } }))
    const refusing: Operation<{ node: string }, { name: string }> = {
      ...getNode,
      scope: () => {
        throw new TransportError({ type: 'Refused', message: 'Too many', status: 0 })
      },
    }
    await expect(
      createTransport({ fetch: fetcher }).request(refusing, { node: 'n1' }),
    ).rejects.toMatchObject({
      type: 'Refused',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('passes AbortSignal through without converting AbortError', async () => {
    const client = createTransport({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    })
    const controller = new AbortController()
    const pending = client.request(getNode, { node: 'n1' }, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('declared framework response behavior', () => {
  it('accepts the document refresh envelope for a void document method, but rejects arbitrary payloads', async () => {
    const save: Operation<Record<string, never>, null> = {
      id: 'save',
      owner: 'writer',
      kind: 'mutation',
      method: 'POST',
      path: '/save',
      empty: true,
      validateOutput(output): asserts output is null {
        if (output !== null) throw new TypeError('Expected a void method')
      },
    }
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ docs: [{ name: 'document' }] }))
      .mockResolvedValueOnce(response({ unexpected: true }))
    const client = createTransport({ fetch: network })
    await expect(client.request(save, {})).resolves.toBeNull()
    await expect(client.request(save, {})).rejects.toThrow('Expected a void method')
  })
  it('does not retry a mutation implemented by a legacy GET endpoint', async () => {
    const write: Operation<{ token: string }, unknown> = {
      id: 'subscribe',
      owner: 'suite',
      kind: 'mutation',
      method: 'GET',
      path: '/subscribe',
    }
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ exc_type: 'ServerError' }, 500))
    await expect(
      createTransport({ fetch: network }).request(write, { token: 't' }),
    ).rejects.toMatchObject({ status: 500 })
    expect(network).toHaveBeenCalledTimes(1)
  })
})
