/** Reads share network work while each consumer owns its cancellation. */
import { sha256 } from '@noble/hashes/sha2.js'
import { reactive, shallowRef, type ShallowRef } from 'vue'

import type { Realtime } from '@/platform/realtime'
import type { EntityDeclaration, Operation, RequestContext, Transport } from '@/platform/transport'

import { Entities, isRecord } from './entities'
import type { Effects, Policy, ReadOptions } from './types'

export interface ReadRecord {
  key: string
  reference: Operation
  input: unknown
  partition: string
  policy: Policy
  context?: RequestContext
  value: unknown
  pages: unknown[]
  status: 'pending' | 'success' | 'error'
  error: Error | null
  fetching: number
  fetchingNext: boolean
  stale: boolean
  updatedAt: number
  minRevision: number
  observers: Set<() => void>
}
interface Flight {
  controller: AbortController
  consumers: Set<symbol>
  work: Promise<unknown>
}
interface OptimisticRead {
  before: unknown
  pages: unknown[]
  update(value: unknown): unknown
}

export class Reads {
  readonly partition: ShallowRef<string> = shallowRef(crypto.randomUUID())
  private readonly records = new Map<string, ReadRecord>()
  private readonly flights = new Map<string, Flight>()
  private revision = 0
  private readonly pageRefreshes = new Map<string, number>()
  private readonly rooms = new Map<string, () => void>()
  private readonly gc = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly optimisticUpdates = new Map<ReadRecord, OptimisticRead>()

  constructor(
    private readonly transport: Transport,
    readonly entities: Entities,
    private readonly realtime?: Realtime | false,
    initialPartition?: string,
  ) {
    if (initialPartition) this.partition.value = initialPartition
  }

  retain(record: ReadRecord, observer: () => void, paging: boolean): void {
    const timeout = this.gc.get(record.key)
    if (timeout) clearTimeout(timeout)
    this.gc.delete(record.key)
    record.observers.add(observer)
    if (!this.realtime || this.rooms.has(record.key) || !record.reference.entity) return
    const entity = record.reference.entity
    const doctype = entity.doctype ?? entity.tag.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    const input = isRecord(record.input) ? record.input : {}
    const name = input[entity.id] ?? input[record.reference.nodeParams?.[0] ?? '']
    const leave =
      paging || name === undefined
        ? this.realtime.joinDoctype(doctype)
        : this.realtime.joinDoc(doctype, String(name))
    this.rooms.set(record.key, leave)
  }

  release(record: ReadRecord, observer: () => void): void {
    record.observers.delete(observer)
    if (record.observers.size) return
    this.rooms.get(record.key)?.()
    this.rooms.delete(record.key)
    this.collect(record)
  }

  optimistic<I>(partition: string, input: I, effect: Effects<I>['optimisticReads']) {
    const changes = new Map<ReadRecord, OptimisticRead>()
    if (effect)
      for (const record of this.records.values()) {
        if (
          record.partition !== partition ||
          !effect.references.includes(`${record.reference.owner}.${record.reference.id}`)
        )
          continue
        const change: OptimisticRead = {
          before: record.value,
          pages: record.pages,
          update: (value) =>
            effect.update(input, record.input, this.entities.materialize(value)) ?? value,
        }
        this.optimisticUpdates.set(record, change)
        this.setValue(record, record.value, record.pages)
        changes.set(record, change)
      }
    const finish = (rollback: boolean) => {
      for (const [record, change] of changes) {
        if (this.optimisticUpdates.get(record) !== change) continue
        this.optimisticUpdates.delete(record)
        if (rollback) {
          record.value = change.before
          record.pages = change.pages
        }
      }
    }
    return { commit: () => finish(false), rollback: () => finish(true) }
  }

  /** A refresh can finish during a write; keep its answer underneath the pending change. */
  private setValue(record: ReadRecord, value: unknown, pages: unknown[]): void {
    const change = this.optimisticUpdates.get(record)
    if (change) {
      change.before = value
      change.pages = pages
      record.value = change.update(value)
      record.pages = pages.map(change.update)
    } else {
      record.value = value
      record.pages = pages
    }
  }

  access<I>(policy: Pick<Policy<I>, 'partition'>, input: I, context?: RequestContext): string {
    return (
      this.partition.value + ':' + (context?.partition() ?? policy.partition?.(input) ?? 'session')
    )
  }

  record<I, O>(
    reference: Operation<I, O>,
    input: I,
    policy: Policy<I, O>,
    pages: boolean,
    context?: RequestContext,
  ): ReadRecord {
    const partition = this.access(policy, input, context)
    const key = this.key(reference, input, partition) + (pages ? ':pages' : '')
    let record = this.records.get(key)
    if (!record) {
      record = reactive({
        key,
        reference: reference as Operation,
        input: canonical(input),
        partition,
        policy: policy as Policy,
        context,
        value: undefined,
        pages: [],
        status: 'pending',
        error: null,
        fetching: 0,
        fetchingNext: false,
        stale: true,
        updatedAt: 0,
        minRevision: 0,
        observers: new Set<() => void>(),
      }) as ReadRecord
      this.records.set(key, record)
    }
    return record
  }

  async fetch(
    record: ReadRecord,
    input: unknown = record.input,
    options: ReadOptions = {},
    next = false,
    apply = true,
  ): Promise<unknown> {
    options.signal?.throwIfAborted()
    await this.entities.hydrate(record.partition)
    options.signal?.throwIfAborted()
    if (record.partition !== this.access(record.policy, record.input, record.context))
      throw abortError()
    if (
      options.cache === 'prefer' &&
      !record.stale &&
      Date.now() - record.updatedAt < (record.policy.staleTime ?? 30_000)
    )
      return this.entities.materialize(record.value)
    const partition = record.partition
    const key = this.key(record.reference, input, partition)
    let flight = this.flights.get(key)
    if (flight?.controller.signal.aborted) {
      this.flights.delete(key)
      flight = undefined
    }
    if (!flight) {
      const controller = new AbortController()
      const revision = this.revision
      const reference = record.policy.operation?.(record.reference, input) ?? record.reference
      const work = this.transport
        .request(reference, input, { signal: controller.signal, context: record.context })
        .then((output) => {
          controller.signal.throwIfAborted()
          if (partition !== this.access(record.policy, record.input, record.context))
            throw abortError()
          return { revision, output }
        })
      flight = { controller, consumers: new Set(), work }
      this.flights.set(key, flight)
      const active = flight
      void work
        .finally(() => {
          if (this.flights.get(key) === active) this.flights.delete(key)
        })
        .catch(() => {})
    }
    const token = Symbol()
    flight.consumers.add(token)
    record.fetching += 1
    record.error = null
    if (next) record.fetchingNext = true
    const active = flight
    try {
      const outcome = await canceled(active.work, options.signal)
      if (!isRecord(outcome)) throw new TypeError('Invalid read outcome')
      options.signal?.throwIfAborted()
      if (partition !== this.access(record.policy, record.input, record.context)) throw abortError()
      if (typeof outcome.revision !== 'number') throw new TypeError('Invalid read revision')
      if (outcome.revision < record.minRevision) {
        if (this.flights.get(key) === active) this.flights.delete(key)
        return this.fetch(record, input, options, next, apply)
      }
      const normalized = this.entities.normalize(
        outcome.output,
        record.reference.entity,
        partition,
        outcome.revision,
      )
      if (!apply) return normalized
      if (next) {
        const change = this.optimisticUpdates.get(record)
        this.setValue(record, change?.before ?? record.value, [
          ...(change?.pages ?? record.pages),
          normalized,
        ])
      } else this.setValue(record, normalized, [normalized])
      record.status = 'success'
      record.stale = false
      record.updatedAt = Date.now()
      return outcome.output
    } catch (cause) {
      if (!isAbort(cause)) {
        record.error = asError(cause)
        record.status = 'error'
      }
      throw cause
    } finally {
      active.consumers.delete(token)
      if (!active.consumers.size) active.controller.abort()
      record.fetching -= 1
      if (!record.observers.size && !record.fetching) this.collect(record)
      if (next) record.fetchingNext = false
    }
  }

  async refreshPages(record: ReadRecord, signal?: AbortSignal): Promise<void> {
    const reference = record.reference as Operation & {
      page?: import('@/platform/transport').PageCapability
    }
    const page = reference.page
    if (!page || record.pages.length < 2) {
      await this.fetch(record, record.input, { signal })
      return
    }
    const generation = (this.pageRefreshes.get(record.key) ?? 0) + 1
    this.pageRefreshes.set(record.key, generation)
    const depth = record.pages.length
    const pages: unknown[] = []
    let input = record.input
    for (let index = 0; index < depth; index++) {
      const output = await this.fetch(record, input, { signal }, false, false)
      if (this.pageRefreshes.get(record.key) !== generation) return
      pages.push(output)
      const value = this.entities.materialize(output)
      if (!isRecord(value) || !isRecord(input)) break
      const rows = value[page.rows]
      if (!Array.isArray(rows) || !rows.length) break
      if ('cursor' in page) {
        if (value[page.next] == null) break
        input = { ...input, [page.cursor]: value[page.next] }
      } else {
        const offset = Number(input[page.offset] ?? 0) + rows.length
        if ('more' in page ? value[page.more] !== true : offset >= Number(value[page.total])) break
        input = { ...input, [page.offset]: offset }
      }
    }
    signal?.throwIfAborted()
    if (record.partition !== this.access(record.policy, record.input, record.context))
      throw abortError()
    if (this.pageRefreshes.get(record.key) !== generation) return
    if (record.pages.length > depth) return this.refreshPages(record, signal)
    this.setValue(record, pages[0], pages)
    record.status = 'success'
    record.stale = false
    record.updatedAt = Date.now()
  }

  commit(
    output: unknown,
    declaration: EntityDeclaration | null | undefined,
    partition: string,
  ): void {
    this.revision += 1
    this.entities.normalize(output, declaration, partition, this.revision)
  }

  changed(
    ids: readonly string[],
    invalidates: readonly string[],
    matches?: (queryInput: unknown) => boolean,
  ): void {
    for (const record of this.records.values()) {
      if (record.partition !== this.access(record.policy, record.input, record.context)) continue
      if (matches && !matches(record.input)) continue
      const reference = record.reference
      const input = isRecord(record.input) ? record.input : {}
      const touched = ids.some((id) => input.node === id || input.name === id)
      const listed =
        record.policy.member !== undefined &&
        (ids.length > 0 || invalidates.includes(reference.entity?.tag ?? ''))
      if (
        !touched &&
        !listed &&
        !invalidates.includes(reference.id) &&
        !invalidates.includes(`${reference.owner}.${reference.id}`) &&
        !invalidates.includes(reference.entity?.tag ?? '')
      )
        continue
      record.stale = true
      record.minRevision = this.revision
      if (record.policy.member) {
        for (let i = 0; i < record.pages.length; i++) {
          const page = record.pages[i]
          const data = this.entities.materialize(page)
          if (
            !isRecord(data) ||
            !Array.isArray(data.rows) ||
            !isRecord(page) ||
            !Array.isArray(page.rows)
          )
            continue
          const rows = page.rows
          const materializedRows = data.rows
          page.rows = rows.filter(
            (_, index) =>
              !isRecord(materializedRows[index]) ||
              record.policy.member?.(materializedRows[index], record.input),
          )
        }
      }
      for (const refresh of record.observers) refresh()
    }
  }

  invalidate(predicate: (reference: Operation) => boolean): void {
    this.revision += 1
    for (const record of this.records.values()) {
      if (
        record.partition !== this.access(record.policy, record.input, record.context) ||
        !predicate(record.reference)
      )
        continue
      record.stale = true
      record.minRevision = this.revision
      for (const refresh of record.observers) refresh()
    }
  }

  switchPartition(partition?: string): void {
    for (const leave of this.rooms.values()) leave()
    for (const timeout of this.gc.values()) clearTimeout(timeout)
    this.rooms.clear()
    this.gc.clear()
    for (const flight of this.flights.values()) flight.controller.abort()
    this.flights.clear()
    this.records.clear()
    this.optimisticUpdates.clear()
    this.pageRefreshes.clear()
    this.entities.clear()
    this.revision += 1
    this.partition.value = partition ?? crypto.randomUUID()
  }

  dispose(): void {
    this.switchPartition()
  }

  private collect(record: ReadRecord): void {
    if (this.gc.has(record.key)) return
    const timeout = setTimeout(() => {
      if (!record.observers.size && !record.fetching) this.records.delete(record.key)
      this.gc.delete(record.key)
    }, 5 * 60_000)
    this.gc.set(record.key, timeout)
  }

  private key(reference: Operation, input: unknown, partition: string): string {
    const bytes = sha256(new TextEncoder().encode(JSON.stringify([partition, canonical(input)])))
    const argumentsKey = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return JSON.stringify([partition, reference.owner, reference.id, argumentsKey])
  }
}

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    )
  return value
}
export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}
export function isAbort(value: unknown): boolean {
  return isRecord(value) && value.name === 'AbortError'
}
export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
export function canceled<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError())
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
