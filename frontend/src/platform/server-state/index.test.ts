import { afterEach, describe, expect, it, vi } from 'vitest'

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
const batchOperation: Operation<{ nodes: string[] }, { accepted: boolean }> = {
  id: 'node_batch', owner: 'drive', method: 'POST', path: 'nodes/batch', entity,
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

afterEach(() => vi.useRealTimers())

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

  it('pages by offset and keeps one cache entry for the whole list', async () => {
    const second = { ...node('Forecast'), name: 'n2' }
    const third = { ...node('Archive'), name: 'n3' }
    const mock = mockTransport((_operation, input) =>
      input.offset === 2
        ? { rows: [third], next_cursor: null, has_next: false }
        : { rows: [node(), second], next_cursor: null, has_next: true },
    )
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const result = state.useQuery(infinite(
      childrenOperation as Operation<any, any>,
      { node: 'root', offset: 0, limit: 2 },
      { paging: 'offset' },
    ))
    await result.settled()
    expect(result.hasNext).toBe(true)
    await result.fetchNext()
    expect(mock.request.mock.calls.map(([, input]) => input.offset)).toEqual([0, 2])
    expect(result.rows.map((row) => (row as Node).name)).toEqual(['n1', 'n2', 'n3'])
    expect(result.hasNext).toBe(false)
    state.dispose()
  })

  it('keys window lists by range and does not expose sequential paging', async () => {
    const mock = mockTransport((_operation, input) => ({
      rows: [{ ...node(input.from), name: input.from }],
      next_cursor: null,
    }))
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const september = state.useQuery(infinite(
      childrenOperation as Operation<any, any>,
      { node: 'calendar', from: '2026-09-01', to: '2026-09-30' },
      { paging: 'window' },
    ))
    const october = state.useQuery(infinite(
      childrenOperation as Operation<any, any>,
      { node: 'calendar', from: '2026-10-01', to: '2026-10-31' },
      { paging: 'window' },
    ))
    await Promise.all([september.settled(), october.settled()])
    expect((september.rows[0] as Node | undefined)?.title).toBe('2026-09-01')
    expect((october.rows[0] as Node | undefined)?.title).toBe('2026-10-01')
    expect(september.hasNext).toBe(false)
    await september.fetchNext()
    expect(mock.request).toHaveBeenCalledTimes(2)
    state.dispose()
  })

  it('returns query failures as values and lets a later refetch recover', async () => {
    let fails = true
    const mock = mockTransport(() => {
      if (fails) throw new TransportError({ type: 'DriveForbidden', message: 'No access', status: 403 })
      return node()
    })
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const result = state.useQuery(query(detailOperation, { node: 'n1' }))
    await expect(result.settled()).resolves.toBe(result)
    expect(result).toMatchObject({ status: 'error', error: { type: 'DriveForbidden' } })
    fails = false
    await result.refetch()
    expect(result).toMatchObject({ status: 'success', error: null })
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

  it('writes mutation entities through every query without refetching details', async () => {
    const mock = mockTransport((operation, input) =>
      operation.id === 'node_patch.rename'
        ? node(input.title, '2026-09-15 02:00:00')
        : node(),
    )
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await detail.settled()
    const rename = state.useMutation(mutation(renameOperation))
    await expect(rename.run({ node: 'n1', title: 'Forecast' })).resolves.toMatchObject({ title: 'Forecast' })
    expect(detail.data?.title).toBe('Forecast')
    expect(mock.request.mock.calls.filter(([operation]) => operation.id === 'node_get')).toHaveLength(1)
    state.dispose()
  })

  it('reconciles list membership after a write and revalidates list order', async () => {
    let current = node()
    const mock = mockTransport((operation) => {
      if (operation.id === 'node_patch.rename') {
        current = { ...node('Archived', '2026-09-15 02:00:00'), state: 'Trashed' }
        return current
      }
      return { rows: current.state === 'Active' ? [current] : [], next_cursor: null }
    })
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const children = state.useQuery(infinite(childrenOperation, { node: 'root' }, {
      member: (candidate) => candidate.parent === 'root' && candidate.state === 'Active',
    }))
    await children.settled()
    await state.useMutation(mutation(renameOperation)).run({ node: 'n1', title: 'Archived' })
    expect(children.rows).toEqual([])
    await tick()
    expect(mock.request.mock.calls.filter(([operation]) => operation.id === 'node_children')).toHaveLength(2)
    state.dispose()
  })

  it('marks touched entities stale and refetches their observed queries', async () => {
    let current = node()
    const mock = mockTransport((operation) => {
      if (operation.id === 'node_batch') {
        current = node('Touched', '2026-09-15 02:00:00')
        return { accepted: true }
      }
      return current
    })
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await detail.settled()
    await state.useMutation(mutation(batchOperation, { touches: (input) => input.nodes }))
      .run({ nodes: ['n1'] })
    await tick()
    expect(detail.data?.title).toBe('Touched')
    expect(mock.request.mock.calls.filter(([operation]) => operation.id === 'node_get')).toHaveLength(2)
    state.dispose()
  })

  it('computes invalidation targets from mutation input', async () => {
    let current = node()
    const mock = mockTransport((operation) => {
      if (operation.id === 'node_batch') {
        current = node('Invalidated', '2026-09-15 02:00:00')
        return { accepted: true }
      }
      return current
    })
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await detail.settled()
    await state.useMutation(mutation(batchOperation, {
      invalidates: (input) => input.nodes.includes('n1') ? ['node_get'] : [],
    })).run({ nodes: ['n1'] })
    await tick()
    expect(detail.data?.title).toBe('Invalidated')
    state.dispose()
  })

  it('honors silent error classes while preserving mutation errors as values', async () => {
    const report = vi.fn()
    const mock = mockTransport(() => {
      throw new TransportError({ type: 'DriveConflict', message: 'Changed', status: 417 })
    })
    const state = createServerState({
      transport: mock.transport,
      realtime: false,
      persistence: false,
      onMutationError: report,
    })
    const rename = state.useMutation(mutation(renameOperation), { silent: ['DriveConflict'] })
    await expect(rename.run({ node: 'n1', title: 'Forecast' })).resolves.toBeUndefined()
    expect(rename.error?.type).toBe('DriveConflict')
    expect(report).not.toHaveBeenCalled()
    state.dispose()
  })

  it('lets a registered challenge resolve the error and retry the mutation', async () => {
    let locked = true
    const mock = mockTransport((_operation, input) => {
      if (locked) throw new TransportError({ type: 'DriveLocked', message: 'Password required', status: 403 })
      return node(input.title, '2026-09-15 02:00:00')
    })
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const challenge = vi.fn(async (_error, retry) => {
      locked = false
      return retry()
    })
    const remove = state.onChallenge('DriveLocked', challenge)
    const rename = state.useMutation(mutation(renameOperation))
    await expect(rename.run({ node: 'n1', title: 'Unlocked' })).resolves.toMatchObject({ title: 'Unlocked' })
    expect(rename.error).toBeNull()
    expect(challenge).toHaveBeenCalledOnce()
    expect(mock.request).toHaveBeenCalledTimes(2)
    remove()
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

  it('ignores older realtime versions', async () => {
    const realtime = new FakeRealtime()
    const mock = mockTransport(() => node('Current', '2026-09-15 03:00:00'))
    const state = createServerState({ transport: mock.transport, realtime, persistence: false })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await detail.settled()
    realtime.emit('doc_update', { doctype: 'Drive Node', name: 'n1', modified: '2026-09-15 02:00:00' })
    await tick()
    expect(mock.request).toHaveBeenCalledOnce()
    state.dispose()
  })

  it('coalesces list events and invalidates permission changes', async () => {
    const realtime = new FakeRealtime()
    const mock = mockTransport(() => ({ rows: [node()], next_cursor: null }))
    const state = createServerState({ transport: mock.transport, realtime, persistence: false })
    const children = state.useQuery(infinite(childrenOperation, { node: 'root' }))
    await children.settled()
    realtime.emit('list_update', { doctype: 'Drive Node', name: 'n2' })
    realtime.emit('list_update', { doctype: 'Drive Node', name: 'n3' })
    await tick()
    expect(mock.request).toHaveBeenCalledTimes(2)
    realtime.emit('update_user_permissions', {})
    await tick()
    expect(mock.request).toHaveBeenCalledTimes(3)
    state.dispose()
  })

  it('rekeys cached entities after a realtime rename', async () => {
    const realtime = new FakeRealtime()
    const mock = mockTransport(() => ({ rows: [node()], next_cursor: null }))
    const state = createServerState({ transport: mock.transport, realtime, persistence: false })
    const children = state.useQuery(infinite(childrenOperation, { node: 'root' }))
    await children.settled()
    realtime.emit('doc_rename', { doctype: 'Drive Node', old_name: 'n1', new_name: 'n9' })
    expect(children.rows[0]).toMatchObject({ name: 'n9', title: 'Budget' })
    state.dispose()
  })

  it('pauses queries on SessionExpired and refetches stale observations after resume', async () => {
    let response: Node | Error = node()
    const mock = mockTransport(() => {
      if (response instanceof Error) throw response
      return response
    })
    const state = createServerState({ transport: mock.transport, realtime: false, persistence: false })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await detail.settled()
    response = new TransportError({ type: 'SessionExpired', message: 'Sign in', status: 401 })
    await detail.refetch()
    expect(detail.error?.type).toBe('SessionExpired')

    response = node('After login', '2026-09-15 02:00:00')
    window.dispatchEvent(new Event('focus'))
    await tick()
    expect(mock.request).toHaveBeenCalledTimes(2)
    state.resume()
    await tick()
    expect(detail.data?.title).toBe('After login')
    expect(mock.request).toHaveBeenCalledTimes(3)
    state.dispose()
  })

  it('hydrates persisted entities as stale data and writes fresh entities back', async () => {
    let release!: (value: Node) => void
    const fresh = new Promise<Node>((resolve) => (release = resolve))
    const mock = mockTransport(() => fresh)
    const save = vi.fn(async () => {})
    const state = createServerState({
      transport: mock.transport,
      realtime: false,
      persistence: {
        load: async () => [{
          key: 'drivenode:n1', tag: 'Drive Node', id: 'n1', version: '2026-09-14 01:00:00',
          data: node('Persisted', '2026-09-14 01:00:00'), fetchedAt: 1,
        }],
        save,
      },
    })
    const detail = state.useQuery(query(detailOperation, { node: 'n1' }))
    await tick()
    expect(detail.data?.title).toBe('Persisted')
    expect(detail.isStale).toBe(true)
    expect(detail.isFetching).toBe(true)
    release(node('Fresh', '2026-09-15 02:00:00'))
    await detail.settled()
    await Promise.resolve()
    expect(detail.data?.title).toBe('Fresh')
    expect(save).toHaveBeenCalled()
    state.dispose()
  })
})
