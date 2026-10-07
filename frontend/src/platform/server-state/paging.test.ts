import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

import { createTransport, type MutationRef, type PageRef } from '@/platform/transport'

import { createApiClient } from './index'

type Row = { id: string; read: boolean }
type Input = { start?: number; filter: string }
const page: PageRef<Input, Row, string, { rows: Row[]; more: boolean }> = {
  kind: 'query',
  owner: 'fixture',
  id: 'list',
  method: 'GET',
  path: '/list',
  page: { offset: 'start', rows: 'rows', more: 'more' },
}
const mark: MutationRef<{ id: string }, null> = {
  kind: 'mutation',
  owner: 'fixture',
  id: 'mark',
  method: 'POST',
  path: '/mark',
}
const scopes: ReturnType<typeof effectScope>[] = []
const clients: ReturnType<typeof createApiClient>[] = []
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  clients.splice(0).forEach((client) => client.dispose())
})
function observer<T>(run: () => T): T {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(run)!
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { data } : { errors: [data] }), { status })
}
function client(fetch: typeof globalThis.fetch) {
  const engine = createApiClient(
    {
      fixture: async () => ({
        policy: (reference) =>
          reference.kind === 'query'
            ? {}
            : {
                effects: {
                  invalidates: ['list'],
                  optimisticReads: {
                    references: ['fixture.list'],
                    update(input, _query, data) {
                      if (
                        !data ||
                        typeof data !== 'object' ||
                        !('rows' in data) ||
                        !Array.isArray(data.rows)
                      )
                        return undefined
                      const id =
                        input && typeof input === 'object' && 'id' in input ? input.id : undefined
                      return {
                        ...data,
                        rows: data.rows.map((row: Row) =>
                          row.id === id ? { ...row, read: true } : row,
                        ),
                      }
                    },
                  },
                },
              },
      }),
    },
    { transport: createTransport({ fetch, retryBaseMs: 0 }), persistence: false },
  )
  clients.push(engine)
  return engine
}

describe('shared paging and access contexts', () => {
  it('refreshes every loaded page, rolls back refused optimism, and ends at the continuation flag', async () => {
    let rows: Row[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, read: false }))
    let refuse: ((response: Response) => void) | undefined
    const engine = client(
      vi.fn(async (url, init) => {
        if (init?.method === 'POST')
          return new Promise<Response>((resolve) => {
            refuse = resolve
          })
        const start = Number(new URL(String(url), 'http://test').searchParams.get('start') || 0)
        return json({ rows: rows.slice(start, start + 2), more: start + 2 < rows.length })
      }),
    )
    const list = observer(() => engine.useInfiniteQuery(page, { filter: 'all' }))
    await vi.waitFor(() => expect(list.rows).toHaveLength(2))
    await list.fetchNext()
    expect(list.rows.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(list.hasNext).toBe(false)
    const write = engine.client.mutation(mark, { id: 'c' }, { silent: true })
    const rejection = expect(write).rejects.toMatchObject({ type: 'PermissionError' })
    await vi.waitFor(() => expect(list.rows[2].read).toBe(true))
    refuse!(json({ type: 'PermissionError', message: 'Read only' }, 403))
    await rejection
    expect(list.rows[2].read).toBe(false)
    rows = [{ id: 'new', read: false }, ...rows.slice(0, 2)]
    await list.refetch()
    expect(list.rows.map((row) => row.id)).toEqual(['new', 'a', 'b'])
    expect(list.hasNext).toBe(false)
  })

  it('ends total-based paging on an empty page and immediately detaches a disabled filter', async () => {
    const totalPage: PageRef<Input, Row, string, { rows: Row[]; total: number }> = {
      kind: 'query',
      owner: 'fixture',
      id: 'list',
      method: 'GET',
      path: '/list',
      page: { offset: 'start', rows: 'rows', total: 'total' },
    }
    const engine = client(
      vi.fn(async (url) => {
        const start = Number(new URL(String(url), 'http://test').searchParams.get('start') || 0)
        return json({ rows: start ? [] : [{ id: 'a', read: false }], total: 20 })
      }),
    )
    const input = ref<Input | false>({ filter: 'all' })
    const list = observer(() => engine.useInfiniteQuery(totalPage, input))
    await vi.waitFor(() => expect(list.rows).toHaveLength(1))
    await list.fetchNext()
    expect(list.hasNext).toBe(false)
    input.value = false
    expect(list.rows).toEqual([])
    expect(list.isFetching).toBe(false)
    await list.refetch()
  })

  it('separates credential contexts, rejects a reply after access changes, and sends write keepalive', async () => {
    const held: Array<(response: Response) => void> = []
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise((resolve) => held.push(resolve)))
    const engine = client(fetch)
    let access = 'A'
    const contextA = {
      partition: () => access,
      scope: () => ({ headers: { 'X-Link': 'secret-A' } }),
    }
    const contextB = { partition: () => 'B', scope: () => ({ headers: { 'X-Link': 'secret-B' } }) }
    const a = engine.client.query(page, { filter: 'all' }, { context: contextA })
    const b = engine.client.query(page, { filter: 'all' }, { context: contextB })
    const canceled = expect(a).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    access = 'new-A'
    held[0](json({ rows: [], more: false }))
    held[1](json({ rows: [{ id: 'b', read: false }], more: false }))
    await canceled
    expect((await b).rows[0].id).toBe('b')
    const write = engine.client.mutation(mark, { id: 'b' }, { context: contextB, keepalive: true })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(fetch.mock.calls[2][1]?.keepalive).toBe(true)
    expect(new Headers(fetch.mock.calls[2][1]?.headers).get('X-Link')).toBe('secret-B')
    held[2](json(null))
    await write
  })
})

it('clears pending without recording a refusal when write access changes during an observed save', async () => {
  let complete: ((response: Response) => void) | undefined
  const network = vi.fn(
    async () =>
      new Promise<Response>((resolve) => {
        complete = resolve
      }),
  )
  const engine = client(network)
  let access = 'first'
  const context = { partition: () => access, scope: () => ({}) }
  const save = observer(() => engine.useMutation(mark, { context, silent: true }))
  const result = save.run({ id: 'a' })
  const refused = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(network).toHaveBeenCalledOnce())
  access = 'second'
  complete!(json(null))
  await refused
  expect(save.isPending).toBe(false)
  expect(save.error).toBeNull()
})
