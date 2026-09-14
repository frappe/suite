import { describe, expect, it, vi } from 'vitest'

import type { Realtime, Room, SocketLike } from '@/platform/realtime'
import { TransportError, type Operation, type Transport } from '@/platform/transport'
import { createServerState, infinite, mutation, query } from './index'

type Node = { name: string; title: string; parent: string | null; modified: string; state?: string }
type Page = { rows: Node[]; next_cursor: string | null }

const entity = { tag: 'Drive Node', id: 'name', version: 'modified' }
const detailOperation: Operation<{ node: string }, Node> = {
  id: 'node_get', owner: 'drive', method: 'GET', path: 'nodes/{node}', pathParams: ['node'], nodeParams: ['node'], entity,
}
const childrenOperation: Operation<{ node: string; cursor?: string | null }, Page> = {
  id: 'node_children', owner: 'drive', method: 'GET', path: 'nodes/{node}/children', pathParams: ['node'], nodeParams: ['node'], entity,
}
const renameOperation: Operation<{ node: string; title: string }, Node> = {
  id: 'node_patch.rename', owner: 'drive', method: 'PATCH', path: 'nodes/{node}', pathParams: ['node'], nodeParams: ['node'], entity,
}

const node = (title = 'Budget', modified = '2026-09-15 01:00:00'): Node => ({
  name: 'n1', title, parent: 'root', modified, state: 'Active',
})

class FakeRealtime implements Realtime {
  handlers = new Map<string, Set<(payload: any) => void>>()
  reconnect = new Set<() => void>()
  subscribe<T>(event: string, handler: (payload: T) => void) {
    const handlers = this.handlers.get(event) ?? new Set()
    handlers.add(handler)
    this.handlers.set(event, handlers)
    return () => handlers.delete(handler)
  }
  onReconnect(handler: () => void) { this.reconnect.add(handler); return () => this.reconnect.delete(handler) }
  join(_room: Room) { return () => {} }
  joinDoc(_doctype: string, _name: string) { return () => {} }
  joinDoctype(_doctype: string) { return () => {} }
  socket(): SocketLike { throw new Error('unused') }
  close() {}
  emit(event: string, payload: unknown) { for (const handler of this.handlers.get(event) ?? []) handler(payload) }
}

function mockTransport(handler: (operation: Operation<any, any>, input: any, signal?: AbortSignal) => any) {
  const request = vi.fn(async (operation: Operation<any, any>, input: any, options?: { signal?: AbortSignal }) =>
    handler(operation, input, options?.signal),
  )
  return { transport: { request } as Transport, request }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('server state queries', () => {
  it('serves cached reads and deduplicates an in-flight request', async () => {
    let release!: (value: Node) => void
    const deferred = new Promise<Node>((resolve) => (release = resolve))
    const mock = mockTransport(() => deferred)
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const descriptor = query(detailOperation, { node: 'n1' })
    const first = state.useQuery(descriptor)
    const second = state.useQuery(descriptor)
    const one = first.settled()
    const two = second.settled()
    expect(mock.request).toHaveBeenCalledOnce()
    release(node())
    await Promise.all([one, two])
    expect(first.data?.title).toBe('Budget')

    await state.useQuery(descriptor).settled()
    expect(mock.request).toHaveBeenCalledOnce()
    state.dispose()
  })

  it('keeps stale data while revalidating and refetches on focus', async () => {
    let title = 'First'
    let version = 1
    const mock = mockTransport(() => node(title, `2026-09-15 0${version++}:00:00`))
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const descriptor = query(detailOperation, { node: 'n1' }, { staleTime: 0 })
    const result = state.useQuery(descriptor)
    await result.settled()
    title = 'Second'
    const cached = state.useQuery(descriptor)
    expect(cached.data?.title).toBe('First')
    expect(cached.isFetching).toBe(false)
    await tick()
    expect(cached.data?.title).toBe('Second')

    title = 'Focused'
    window.dispatchEvent(new Event('focus'))
    await tick()
    expect(cached.data?.title).toBe('Focused')
    state.dispose()
  })

  it('cancels requests with AbortSignal without storing an error', async () => {
    let aborted = false
    const mock = mockTransport((_operation, _input, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        aborted = true
        reject(new DOMException('Aborted', 'AbortError'))
      })
    }))
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const result = state.useQuery(query(detailOperation, { node: 'n1' }))
    const settled = result.settled()
    result.cancel()
    await settled
    expect(aborted).toBe(true)
    expect(result.error).toBeNull()
    state.dispose()
  })

  it('pages by cursor through empty windows until next_cursor is null', async () => {
    const mock = mockTransport((_operation, input) =>
      input.cursor === 'empty'
        ? { rows: [], next_cursor: 'last' }
        : input.cursor === 'last'
          ? { rows: [node()], next_cursor: null }
          : { rows: [], next_cursor: 'empty' },
    )
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const result = state.useQuery(infinite(childrenOperation, { node: 'root' }))
    await result.settled()
    expect(result.rows).toEqual([])
    expect(result.hasNext).toBe(true)
    await result.fetchNext()
    expect(result.rows).toEqual([])
    expect(result.hasNext).toBe(true)
    await result.fetchNext()
    expect(result.rows.map((row) => row.name)).toEqual(['n1'])
    expect(result.hasNext).toBe(false)
    state.dispose()
  })
})

describe('server state mutations and realtime', () => {
  it('invalidates reads after mutations', async () => {
    let current = node()
    const mock = mockTransport((operation, input) => {
      if (operation.id === 'node_patch.rename') {
        current = node(input.title, '2026-09-15 02:00:00')
        return current
      }
      return current
    })
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await detail.settled()
    const rename = state.useMutation(mutation(renameOperation, { invalidates: ['node_get'] }))
    await rename.run({ node: 'n1', title: 'Forecast' })
    await tick()
    expect(detail.data?.title).toBe('Forecast')
    expect(mock.request.mock.calls.filter(([operation]) => operation.id === 'node_get')).toHaveLength(2)
    state.dispose()
  })

  it('applies optimistic patches and rolls them back on failure', async () => {
    let rejectRename!: (error: unknown) => void
    const renameRequest = new Promise((_resolve, reject) => (rejectRename = reject))
    const mock = mockTransport((operation) => operation.id === 'node_get' ? node() : renameRequest)
    const state = createServerState({
      transport: mock.transport,
      realtime: false,
      persistence: false,
      onMutationError: () => {},
    })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await detail.settled()
    const rename = state.useMutation(mutation(renameOperation, {
      optimistic: (input, current) => ({ ...current, title: input.title }),
    }))
    const pending = rename.run({ node: 'n1', title: 'Optimistic' })
    await tick()
    expect(detail.data?.title).toBe('Optimistic')
    rejectRename(new TransportError({ type: 'DriveConflict', message: 'Changed', status: 417 }))
    await pending
    expect(detail.data?.title).toBe('Budget')
    expect(rename.error?.type).toBe('DriveConflict')
    state.dispose()
  })

  it('ignores equal realtime versions and refetches newer ones', async () => {
    const realtime = new FakeRealtime()
    let current = node()
    const mock = mockTransport(() => current)
    const state = createServerState({ transport: mock.transport, realtime, persistence: false })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await detail.settled()
    realtime.emit('doc_update', { doctype: 'Drive Node', name: 'n1', modified: current.modified })
    await tick()
    expect(mock.request).toHaveBeenCalledOnce()

    current = node('Realtime', '2026-09-15 03:00:00')
    realtime.emit('doc_update', { doctype: 'Drive Node', name: 'n1', modified: current.modified })
    await tick()
    expect(mock.request).toHaveBeenCalledTimes(2)
    expect(detail.data?.title).toBe('Realtime')
    state.dispose()
  })
})
