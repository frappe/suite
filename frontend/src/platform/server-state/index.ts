import { get as idbGet, set as idbSet } from 'idb-keyval'
import {
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
  watch,
  type WatchStopHandle,
} from 'vue'

import { realtime as defaultRealtime, type Realtime } from '@/platform/realtime'
import {
  TransportError,
  transport as defaultTransport,
  type EntityDeclaration,
  type Operation,
  type PlatformError,
  type Transport,
} from '@/platform/transport'

export type QueryStatus = 'pending' | 'error' | 'success'
export type PagingStrategy = 'cursor' | 'offset' | 'window'

export interface QueryOptions<Row = unknown> {
  staleTime?: number
  gcTime?: number
  refetchInterval?: number
  member?: (row: Row) => boolean
  invalidates?: readonly string[]
}

export interface InfiniteOptions<Row = unknown> extends QueryOptions<Row> {
  paging?: PagingStrategy
  cursorParam?: string
  offsetParam?: string
  limitParam?: string
}

export interface MutationOptions<Input = any, Entity = any> {
  optimistic?: (input: Input, entity: Entity) => Entity | Partial<Entity> | void
  touches?: (input: Input) => readonly string[]
  invalidates?: readonly string[] | ((input: Input) => readonly string[])
}

export interface QueryDescriptor<Input = any, Output = any, Row = Output> {
  kind: 'query'
  operation: Operation<Input, Output>
  input: Input
  options: QueryOptions<Row>
}

export interface InfiniteDescriptor<Input = any, Row = any> {
  kind: 'infinite'
  operation: Operation<Input, { rows: Row[]; next_cursor?: string | null; [key: string]: any }>
  input: Input
  options: InfiniteOptions<Row>
}

export interface MutationDescriptor<Input = any, Output = any, Entity = any> {
  kind: 'mutation'
  operation: Operation<Input, Output>
  options: MutationOptions<Input, Entity>
}

export interface UploadDescriptor<Input = any, Output = any> {
  kind: 'upload'
  create: Operation<Input, unknown>
  chunk: Operation<any, unknown>
  finish: Operation<any, Output>
  options: MutationOptions<Input, any> & { chunkSize?: number }
}

export type ReadDescriptor<Input = any, Output = any> =
  | QueryDescriptor<Input, Output>
  | InfiniteDescriptor<Input, any>
export type DescriptorSource<D extends ReadDescriptor = ReadDescriptor> =
  | D
  | false
  | null
  | undefined
  | (() => D | false | null | undefined)

export interface QueryResult<Data = unknown> {
  readonly data: Data | undefined
  readonly status: QueryStatus
  readonly error: PlatformError | null
  readonly isFetching: boolean
  readonly isStale: boolean
  readonly rows: Data extends { rows: Array<infer Row> } ? Row[] : never[]
  readonly hasNext: boolean
  readonly isFetchingNext: boolean
  refetch(): Promise<QueryResult<Data>>
  fetchNext(): Promise<QueryResult<Data>>
  settled(): Promise<QueryResult<Data>>
  cancel(): void
}

export interface MutationResult<Input = unknown, Output = unknown> {
  readonly isPending: boolean
  readonly error: PlatformError | null
  readonly progress: number | null
  run(input: Input): Promise<Output | undefined>
  reset(): void
  cancel(): void
}

export interface EntityPersistence {
  load(): Promise<PersistedEntity[]>
  save(entities: PersistedEntity[]): Promise<void>
}

export interface PersistedEntity {
  key: string
  tag: string
  id: string
  version: string | number | null
  data: Record<string, any>
  fetchedAt: number
}

export interface CreateServerStateOptions {
  transport: Transport
  realtime?: Realtime | false
  persistence?: EntityPersistence | false
  staleTime?: number
  gcTime?: number
  now?: () => number
  onMutationError?: (error: PlatformError) => void
}

export interface ServerState {
  useQuery<D extends ReadDescriptor>(source: DescriptorSource<D>): QueryResult<DescriptorData<D>>
  useMutation<Input, Output>(
    descriptor: MutationDescriptor<Input, Output> | UploadDescriptor<Input, Output>,
    options?: { silent?: boolean | readonly string[] },
  ): MutationResult<Input, Output>
  invalidateAll(predicate?: (descriptor: ReadDescriptor) => boolean): void
  onChallenge(
    type: string,
    handler: ChallengeHandler,
  ): () => void
  resume(): void
  dispose(): void
}

export type ChallengeHandler = (
  error: PlatformError,
  retry: () => Promise<unknown>,
) => Promise<unknown>

type DescriptorData<D> = D extends QueryDescriptor<any, infer O>
  ? O
  : D extends InfiniteDescriptor<any, infer Row>
    ? { rows: Row[]; next_cursor?: string | null; [key: string]: any }
    : never

type EntityRecord = {
  key: string
  tag: string
  id: string
  version: string | number | null
  data: Record<string, any>
  fetchedAt: number
  stale: boolean
}

type EntityRef = { __suiteEntity: string }
type Normalized = any

type QueryRecord = {
  key: string
  descriptor: ReadDescriptor
  normalized: Normalized | undefined
  pages: Normalized[]
  status: QueryStatus
  error: PlatformError | null
  isFetching: boolean
  isFetchingNext: boolean
  stale: boolean
  updatedAt: number
  promise: Promise<void> | null
  controller: AbortController | null
  observers: number
  gcTimer: ReturnType<typeof setTimeout> | null
  interval: ReturnType<typeof setInterval> | null
  rooms: Array<() => void>
}

const DEFAULT_STALE_TIME = 30_000
const DEFAULT_GC_TIME = 5 * 60_000
const PERSISTENCE_KEY = 'suite-platform-entities-v1'

export function query<Input, Output, Row = Output>(
  operation: Operation<Input, Output>,
  input: Input,
  options: QueryOptions<Row> = {},
): QueryDescriptor<Input, Output, Row> {
  assertOperation(operation)
  return { kind: 'query', operation, input, options }
}

export function infinite<Input, Row>(
  operation: Operation<Input, { rows: Row[]; next_cursor?: string | null; [key: string]: any }>,
  input: Input,
  options: InfiniteOptions<Row> = {},
): InfiniteDescriptor<Input, Row> {
  assertOperation(operation)
  return { kind: 'infinite', operation, input, options: { paging: 'cursor', ...options } }
}

export function mutation<Input, Output, Entity = any>(
  operation: Operation<Input, Output>,
  options: MutationOptions<Input, Entity> = {},
): MutationDescriptor<Input, Output, Entity> {
  assertOperation(operation)
  return { kind: 'mutation', operation, options }
}

export function upload<Input, Output>(
  create: Operation<Input, unknown>,
  chunk: Operation<any, unknown>,
  finish: Operation<any, Output>,
  options: UploadDescriptor<Input, Output>['options'] = {},
): UploadDescriptor<Input, Output> {
  assertOperation(create)
  assertOperation(chunk)
  assertOperation(finish)
  return { kind: 'upload', create, chunk, finish, options }
}

export function createServerState(options: CreateServerStateOptions): ServerState {
  const now = options.now ?? Date.now
  const staleTime = options.staleTime ?? DEFAULT_STALE_TIME
  const gcTime = options.gcTime ?? DEFAULT_GC_TIME
  const entityStore = new Map<string, EntityRecord>()
  const queryStore = new Map<string, QueryRecord>()
  const challenges = new Map<string, ChallengeHandler>()
  const realtime = options.realtime === undefined ? defaultRealtime : options.realtime
  const persistence = options.persistence === undefined ? browserPersistence() : options.persistence
  const cleanup: Array<() => void> = []
  let paused = false
  let mutationTail: Promise<unknown> = Promise.resolve()
  let persistQueued = false

  const hydrated = persistence
    ? persistence
        .load()
        .then((records) => {
          for (const persisted of records) {
            entityStore.set(
              persisted.key,
              reactive({ ...persisted, stale: true }) as EntityRecord,
            )
          }
        })
        .catch(() => {})
    : Promise.resolve()

  function useQuery<D extends ReadDescriptor>(source: DescriptorSource<D>): QueryResult<DescriptorData<D>> {
    const current = ref<QueryRecord | null>(null)
    let stop: WatchStopHandle | null = null

    const attach = (descriptor: D | false | null | undefined) => {
      detach(current.value)
      current.value = null
      if (!descriptor) return
      assertDescriptor(descriptor)
      const record = getQueryRecord(descriptor)
      current.value = record
      observe(record)
      void hydrated.then(() => {
        seedFromPersistedEntity(record)
        if (shouldFetch(record)) void fetchRecord(record)
      })
    }

    if (typeof source === 'function') {
      stop = watch(source as () => D | false | null | undefined, attach, { immediate: true })
    } else attach(source)

    const result = reactive({
      get data() {
        return current.value ? materializeRecord(current.value) : undefined
      },
      get status() {
        return current.value?.status ?? 'pending'
      },
      get error() {
        return current.value?.error ?? null
      },
      get isFetching() {
        return current.value?.isFetching ?? false
      },
      get isStale() {
        const record = current.value
        return record ? isRecordStale(record) : true
      },
      get rows() {
        const data = current.value ? materializeRecord(current.value) : undefined
        return isObject(data) && Array.isArray(data.rows) ? data.rows : []
      },
      get hasNext() {
        return current.value ? hasNext(current.value) : false
      },
      get isFetchingNext() {
        return current.value?.isFetchingNext ?? false
      },
      async refetch() {
        if (current.value) await fetchRecord(current.value, false, true)
        return result
      },
      async fetchNext() {
        if (current.value) await fetchRecord(current.value, true)
        return result
      },
      async settled() {
        if (current.value) await fetchRecord(current.value)
        return result
      },
      cancel() {
        current.value?.controller?.abort()
      },
    }) as QueryResult<DescriptorData<D>>

    if (getCurrentScope()) {
      onScopeDispose(() => {
        stop?.()
        detach(current.value)
      })
    }
    return result
  }

  function useMutation<Input, Output>(
    descriptor: MutationDescriptor<Input, Output> | UploadDescriptor<Input, Output>,
    mutationOptions: { silent?: boolean | readonly string[] } = {},
  ): MutationResult<Input, Output> {
    assertMutationDescriptor(descriptor)
    const state = reactive({
      isPending: false,
      error: null as PlatformError | null,
      progress: null as number | null,
      controller: null as AbortController | null,
    })

    const result: MutationResult<Input, Output> = {
      get isPending() {
        return state.isPending
      },
      get error() {
        return state.error
      },
      get progress() {
        return state.progress
      },
      run(input: Input) {
        const operation = descriptor.kind === 'upload' ? descriptor.create : descriptor.operation
        operation.validateInput?.(input)
        state.isPending = true
        state.error = null
        state.controller = new AbortController()
        const execute = () => executeMutation(descriptor, input, state.controller!.signal, state)
        const pending = mutationTail.then(execute, execute)
        mutationTail = pending.catch(() => undefined)
        return pending
          .catch(async (cause) => {
            const error = platformError(cause)
            state.error = error
            if (error.type === 'SessionExpired') paused = true
            const challenge = challenges.get(error.type)
            if (challenge) {
              try {
                const retried = await challenge(error, execute)
                if (retried !== undefined) state.error = null
                return retried as Output | undefined
              } catch (challengeCause) {
                state.error = platformError(challengeCause)
              }
            }
            if (!isSilent(state.error, mutationOptions.silent)) {
              ;(options.onMutationError ?? defaultMutationErrorReporter)(state.error)
            }
            return undefined
          })
          .finally(() => {
            state.isPending = false
            state.controller = null
          })
      },
      reset() {
        state.error = null
        state.progress = null
      },
      cancel() {
        state.controller?.abort()
      },
    }
    return result
  }

  async function executeMutation<Input, Output>(
    descriptor: MutationDescriptor<Input, Output> | UploadDescriptor<Input, Output>,
    input: Input,
    signal: AbortSignal,
    state: { progress: number | null },
  ): Promise<Output> {
    const operation = descriptor.kind === 'upload' ? descriptor.create : descriptor.operation
    const snapshots = applyOptimistic(operation.entity, descriptor.options, input)
    try {
      let output: Output
      if (descriptor.kind === 'upload') {
        output = await executeUpload(descriptor, input, signal, state)
      } else {
        output = await options.transport.request(descriptor.operation, input, { signal })
      }
      const changed = normalizeOutput(output, finalOperation(descriptor).entity)
      processMutationEffects(descriptor, input, changed)
      return output
    } catch (error) {
      rollback(snapshots)
      throw error
    }
  }

  async function executeUpload<Input, Output>(
    descriptor: UploadDescriptor<Input, Output>,
    input: Input,
    signal: AbortSignal,
    state: { progress: number | null },
  ): Promise<Output> {
    const created = await options.transport.request(descriptor.create, input, { signal })
    const record = input as Record<string, any>
    const file = record.file
    if (typeof Blob !== 'undefined' && file instanceof Blob) {
      const size = descriptor.options.chunkSize ?? 1024 * 1024
      for (let offset = 0; offset < file.size; offset += size) {
        await options.transport.request(
          descriptor.chunk,
          { ...record, upload: created, offset, chunk: file.slice(offset, offset + size) },
          { signal },
        )
        state.progress = Math.min(1, (offset + size) / file.size)
      }
    }
    return options.transport.request(descriptor.finish, { ...record, upload: created }, { signal })
  }

  function getQueryRecord(descriptor: ReadDescriptor): QueryRecord {
    const key = descriptorKey(descriptor)
    let record = queryStore.get(key)
    if (record) {
      record.descriptor = descriptor
      return record
    }
    record = reactive({
      key,
      descriptor,
      normalized: undefined,
      pages: [],
      status: 'pending' as QueryStatus,
      error: null,
      isFetching: false,
      isFetchingNext: false,
      stale: true,
      updatedAt: 0,
      promise: null,
      controller: null,
      observers: 0,
      gcTimer: null,
      interval: null,
      rooms: [],
    }) as QueryRecord
    queryStore.set(key, record)
    return record
  }

  async function fetchRecord(record: QueryRecord, next = false, force = false): Promise<void> {
    if (paused) return
    if (record.promise && !next) return record.promise
    if (next && (record.isFetchingNext || !hasNext(record))) return
    if (!force && !next && record.normalized !== undefined && !isRecordStale(record)) return

    const controller = new AbortController()
    record.controller = controller
    if (next) record.isFetchingNext = true
    else record.isFetching = true
    record.error = null
    const input = next ? nextInput(record) : record.descriptor.input
    const work = options.transport
      .request(record.descriptor.operation as Operation<any, any>, input, { signal: controller.signal })
      .then((output) => {
        const normalized = normalizeOutput(output, record.descriptor.operation.entity)
        if (next && record.descriptor.kind === 'infinite') record.pages.push(normalized.value)
        else if (record.descriptor.kind === 'infinite') record.pages = [normalized.value]
        else record.normalized = normalized.value
        if (record.descriptor.kind === 'infinite') record.normalized = mergePages(record.pages)
        record.status = 'success'
        record.stale = false
        record.updatedAt = now()
      })
      .catch((cause) => {
        if (isAbort(cause)) return
        const error = platformError(cause)
        record.error = error
        record.status = 'error'
        if (error.type === 'SessionExpired') paused = true
      })
      .finally(() => {
        record.isFetching = false
        record.isFetchingNext = false
        record.controller = null
        record.promise = null
      })
    record.promise = work
    return work
  }

  function normalizeOutput(value: unknown, declaration?: EntityDeclaration | null): {
    value: Normalized
    changed: EntityRecord[]
  } {
    const changed: EntityRecord[] = []
    const visit = (item: any, entityPosition = true): Normalized => {
      if (Array.isArray(item)) return item.map((child) => visit(child, entityPosition))
      if (!isObject(item)) return item
      if (entityPosition && declaration && validEntity(item, declaration)) {
        const id = String(item[declaration.id])
        const key = entityKey(declaration.tag, id)
        const versionField = declaration.version || null
        const incomingVersion = versionField ? (item[versionField] ?? null) : null
        let entity = entityStore.get(key)
        if (!entity) {
          entity = reactive({
            key,
            tag: declaration.tag,
            id,
            version: incomingVersion,
            data: structuredCloneSafe(item),
            fetchedAt: now(),
            stale: false,
          }) as EntityRecord
          entityStore.set(key, entity)
          changed.push(entity)
        } else if (acceptVersion(entity.version, incomingVersion)) {
          entity.data = structuredCloneSafe(item)
          entity.version = incomingVersion
          entity.fetchedAt = now()
          entity.stale = false
          changed.push(entity)
        }
        queuePersistence()
        return { __suiteEntity: key } satisfies EntityRef
      }
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [
          key,
          visit(child, entityPosition && key === 'rows'),
        ]),
      )
    }
    return { value: visit(value), changed }
  }

  function materialize(value: Normalized): any {
    if (Array.isArray(value)) return value.map(materialize)
    if (!isObject(value)) return value
    if (typeof value.__suiteEntity === 'string') return entityStore.get(value.__suiteEntity)?.data
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materialize(child)]))
  }

  function materializeRecord(record: QueryRecord): any {
    return materialize(record.normalized)
  }

  function observe(record: QueryRecord): void {
    record.observers += 1
    if (record.gcTimer) {
      clearTimeout(record.gcTimer)
      record.gcTimer = null
    }
    if (record.observers > 1) return
    joinRecordRooms(record)
    const every = record.descriptor.options.refetchInterval
    if (every && every > 0) record.interval = setInterval(() => void fetchRecord(record, false, true), every)
  }

  function detach(record: QueryRecord | null): void {
    if (!record || record.observers === 0) return
    record.observers -= 1
    if (record.observers > 0) return
    if (record.interval) clearInterval(record.interval)
    record.interval = null
    record.controller?.abort()
    for (const leave of record.rooms.splice(0)) leave()
    const timeout = record.descriptor.options.gcTime ?? gcTime
    record.gcTimer = setTimeout(() => {
      if (!record.observers) queryStore.delete(record.key)
    }, timeout)
  }

  function joinRecordRooms(record: QueryRecord): void {
    if (!realtime) return
    const entity = record.descriptor.operation.entity
    if (!entity) return
    const doctype = entity.doctype ?? doctypeFromTag(entity.tag)
    if (record.descriptor.kind === 'infinite') {
      record.rooms.push(realtime.joinDoctype(doctype))
      return
    }
    const input = record.descriptor.input as Record<string, unknown>
    const id = input[entity.id] ?? input[record.descriptor.operation.nodeParams?.[0] ?? '']
    if (id !== undefined) record.rooms.push(realtime.joinDoc(doctype, String(id)))
  }

  function seedFromPersistedEntity(record: QueryRecord): void {
    if (record.normalized !== undefined || record.descriptor.kind !== 'query') return
    const declaration = record.descriptor.operation.entity
    if (!declaration) return
    const input = record.descriptor.input as Record<string, unknown>
    const id = input[declaration.id] ?? input[record.descriptor.operation.nodeParams?.[0] ?? '']
    if (id === undefined) return
    const entity = entityStore.get(entityKey(declaration.tag, String(id)))
    if (!entity) return
    record.normalized = { __suiteEntity: entity.key }
    record.status = 'success'
    record.stale = true
    record.updatedAt = 0
  }

  function applyOptimistic<Input>(
    declaration: EntityDeclaration | null | undefined,
    mutationOptions: MutationOptions<Input>,
    input: Input,
  ): Array<{ entity: EntityRecord; data: Record<string, any>; version: string | number | null }> {
    if (!declaration || !mutationOptions.optimistic) return []
    const values = input as Record<string, unknown>
    const ids = new Set<string>()
    const direct = values[declaration.id]
    if (direct !== undefined) ids.add(String(direct))
    for (const value of Object.values(values)) {
      if (typeof value === 'string' && entityStore.has(entityKey(declaration.tag, value))) ids.add(value)
    }
    const snapshots: Array<{
      entity: EntityRecord
      data: Record<string, any>
      version: string | number | null
    }> = []
    for (const id of ids) {
      const entity = entityStore.get(entityKey(declaration.tag, id))
      if (!entity) continue
      snapshots.push({ entity, data: structuredCloneSafe(entity.data), version: entity.version })
      const patch = mutationOptions.optimistic(input, structuredCloneSafe(entity.data))
      if (patch) entity.data = { ...entity.data, ...patch }
      entity.stale = true
      reconcileMembership(entity)
    }
    return snapshots
  }

  function rollback(
    snapshots: Array<{ entity: EntityRecord; data: Record<string, any>; version: string | number | null }>,
  ): void {
    for (const snapshot of snapshots) {
      snapshot.entity.data = snapshot.data
      snapshot.entity.version = snapshot.version
      snapshot.entity.stale = false
      reconcileMembership(snapshot.entity)
    }
  }

  function processMutationEffects<Input>(
    descriptor: MutationDescriptor<Input, unknown> | UploadDescriptor<Input, unknown>,
    input: Input,
    normalized: { changed: EntityRecord[] },
  ): void {
    for (const entity of normalized.changed) reconcileMembership(entity)
    const touched = descriptor.options.touches?.(input) ?? []
    for (const id of touched) {
      for (const entity of entityStore.values()) {
        if (entity.id === id) markEntityStale(entity)
      }
    }
    const declared = descriptor.options.invalidates
    const invalidates = typeof declared === 'function' ? declared(input) : (declared ?? [])
    if (invalidates.length) {
      for (const record of queryStore.values()) {
        const tag = record.descriptor.operation.entity?.tag
        if (invalidates.includes(record.descriptor.operation.id) || (tag && invalidates.includes(tag))) {
          invalidateRecord(record)
        }
      }
    }
  }

  function reconcileMembership(entity: EntityRecord): void {
    for (const record of queryStore.values()) {
      const descriptor = record.descriptor
      const member = descriptor.options.member
      if (!member || descriptor.operation.entity?.tag !== entity.tag || record.normalized === undefined) continue
      const belongs = member(entity.data)
      const references = refsIn(record.normalized)
      const contains = references.has(entity.key)
      if (belongs && !contains) addEntityReference(record, entity.key)
      if (!belongs && contains) record.normalized = removeEntityReference(record.normalized, entity.key)
      invalidateRecord(record)
    }
  }

  function addEntityReference(record: QueryRecord, key: string): void {
    const target = record.descriptor.kind === 'infinite' ? record.pages[0] : record.normalized
    if (Array.isArray(target)) target.push({ __suiteEntity: key })
    else if (isObject(target) && Array.isArray(target.rows)) target.rows.push({ __suiteEntity: key })
    if (record.descriptor.kind === 'infinite') record.normalized = mergePages(record.pages)
  }

  function invalidateRecord(record: QueryRecord): void {
    record.stale = true
    if (record.observers) void fetchRecord(record, false, true)
  }

  function markEntityStale(entity: EntityRecord): void {
    entity.stale = true
    for (const record of queryStore.values()) {
      if (refsIn(record.normalized).has(entity.key)) invalidateRecord(record)
    }
  }

  function invalidateAll(predicate?: (descriptor: ReadDescriptor) => boolean): void {
    for (const record of queryStore.values()) {
      if (!predicate || predicate(record.descriptor)) invalidateRecord(record)
    }
  }

  function onChallenge(type: string, handler: ChallengeHandler): () => void {
    challenges.set(type, handler)
    return () => {
      if (challenges.get(type) === handler) challenges.delete(type)
    }
  }

  function resume(): void {
    paused = false
    for (const record of queryStore.values()) {
      if (record.observers && record.stale) void fetchRecord(record, false, true)
    }
  }

  function queuePersistence(): void {
    if (!persistence || persistQueued) return
    persistQueued = true
    queueMicrotask(() => {
      persistQueued = false
      const records = [...entityStore.values()].map(({ stale: _stale, ...entity }) =>
        structuredCloneSafe(entity),
      )
      void persistence.save(records).catch(() => {})
    })
  }

  if (typeof window !== 'undefined') {
    const refetchObserved = () => {
      for (const record of queryStore.values()) {
        if (record.observers) void fetchRecord(record, false, true)
      }
    }
    const visibility = () => {
      if (document.visibilityState === 'visible') refetchObserved()
    }
    window.addEventListener('focus', refetchObserved)
    document.addEventListener('visibilitychange', visibility)
    cleanup.push(() => window.removeEventListener('focus', refetchObserved))
    cleanup.push(() => document.removeEventListener('visibilitychange', visibility))
  }

  if (realtime) {
    cleanup.push(realtime.onReconnect(() => {
      for (const record of queryStore.values()) {
        if (record.observers) void fetchRecord(record, false, true)
      }
    }))
    cleanup.push(
      realtime.subscribe<{ doctype: string; name: string; modified?: string }>('doc_update', (event) => {
        const entity = entityStore.get(entityKey(event.doctype, event.name))
        if (!entity) return
        if (event.modified !== undefined && compareVersion(event.modified, entity.version) <= 0) return
        markEntityStale(entity)
      }),
    )
    cleanup.push(
      realtime.subscribe<{ doctype: string; name: string }>('list_update', (event) => {
        const key = entityKey(event.doctype, event.name)
        for (const record of queryStore.values()) {
          if (
            record.descriptor.kind === 'infinite' &&
            sameTag(record.descriptor.operation.entity?.tag, event.doctype) &&
            !refsIn(record.normalized).has(key)
          ) {
            invalidateRecord(record)
          }
        }
      }),
    )
    cleanup.push(
      realtime.subscribe<{
        doctype: string
        old_name?: string
        new_name?: string
        old?: string
        new?: string
      }>('doc_rename', (event) => {
        const oldName = event.old_name ?? event.old
        const newName = event.new_name ?? event.new
        if (!oldName || !newName) return
        const oldKey = entityKey(event.doctype, oldName)
        const entity = entityStore.get(oldKey)
        if (!entity) return
        const newKey = entityKey(event.doctype, newName)
        entityStore.delete(oldKey)
        entity.key = newKey
        entity.id = newName
        const idField = findEntityIdField(event.doctype)
        if (idField) entity.data[idField] = newName
        entityStore.set(newKey, entity)
        for (const record of queryStore.values()) replaceReference(record, oldKey, newKey)
        queuePersistence()
      }),
    )
    cleanup.push(realtime.subscribe('update_user_permissions', () => invalidateAll()))
  }

  function findEntityIdField(tag: string): string | null {
    for (const record of queryStore.values()) {
      const entity = record.descriptor.operation.entity
      if (entity && sameTag(entity.tag, tag)) return entity.id
    }
    return null
  }

  function dispose(): void {
    for (const dispose of cleanup.splice(0)) dispose()
    for (const record of queryStore.values()) {
      record.controller?.abort()
      if (record.gcTimer) clearTimeout(record.gcTimer)
      if (record.interval) clearInterval(record.interval)
      for (const leave of record.rooms) leave()
    }
    queryStore.clear()
  }

  return { useQuery, useMutation, invalidateAll, onChallenge, resume, dispose }

  function isRecordStale(record: QueryRecord): boolean {
    return (
      record.stale ||
      record.updatedAt === 0 ||
      now() - record.updatedAt >= (record.descriptor.options.staleTime ?? staleTime)
    )
  }

  function shouldFetch(record: QueryRecord): boolean {
    return record.normalized === undefined || isRecordStale(record)
  }
}

function mergePages(pages: Normalized[]): Normalized {
  if (!pages.length) return undefined
  const first = pages[0]
  if (!isObject(first) || !Array.isArray(first.rows)) return pages.flat()
  const last = pages.at(-1)
  return {
    ...first,
    ...(isObject(last) ? last : {}),
    rows: pages.flatMap((page) => (isObject(page) && Array.isArray(page.rows) ? page.rows : [])),
  }
}

function hasNext(record: QueryRecord): boolean {
  if (record.descriptor.kind !== 'infinite' || !record.pages.length) return false
  const last = record.pages.at(-1)
  if (!isObject(last)) return false
  const paging = record.descriptor.options.paging ?? 'cursor'
  if (paging === 'cursor') return last.next_cursor !== null && last.next_cursor !== undefined
  if (paging === 'offset') {
    if (typeof last.has_next === 'boolean') return last.has_next
    const limit = Number((record.descriptor.input as Record<string, unknown>)[record.descriptor.options.limitParam ?? 'limit'])
    return Array.isArray(last.rows) && (!Number.isFinite(limit) || last.rows.length >= limit)
  }
  return false
}

function nextInput(record: QueryRecord): any {
  if (record.descriptor.kind !== 'infinite') return record.descriptor.input
  const input = { ...(record.descriptor.input as Record<string, unknown>) }
  const last = record.pages.at(-1)
  const paging = record.descriptor.options.paging ?? 'cursor'
  if (paging === 'cursor') input[record.descriptor.options.cursorParam ?? 'cursor'] = last?.next_cursor
  if (paging === 'offset') {
    const field = record.descriptor.options.offsetParam ?? 'offset'
    input[field] = Number(input[field] ?? 0) + record.pages.reduce((count, page) => count + (page?.rows?.length ?? 0), 0)
  }
  return input
}

function descriptorKey(descriptor: ReadDescriptor): string {
  const input = { ...(descriptor.input as Record<string, unknown>) }
  if (descriptor.kind === 'infinite') {
    delete input[descriptor.options.cursorParam ?? 'cursor']
    delete input[descriptor.options.offsetParam ?? 'offset']
  }
  return `${descriptor.kind}:${descriptor.operation.id}:${stableStringify(input)}`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function validEntity(value: Record<string, any>, declaration: EntityDeclaration): boolean {
  return value[declaration.id] !== undefined && value[declaration.id] !== null
}

function entityKey(tag: string, id: string): string {
  return `${canonicalTag(tag)}:${id}`
}

function canonicalTag(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function sameTag(left: string | undefined, right: string): boolean {
  return !!left && canonicalTag(left) === canonicalTag(right)
}

function doctypeFromTag(tag: string): string {
  return tag.includes(' ') ? tag : tag.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

function acceptVersion(current: string | number | null, incoming: string | number | null): boolean {
  if (incoming === null || current === null) return true
  return compareVersion(incoming, current) >= 0
}

function compareVersion(left: string | number | null, right: string | number | null): number {
  if (left === right) return 0
  if (right === null) return 1
  if (left === null) return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

function refsIn(value: Normalized, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) refsIn(item, found)
  else if (isObject(value)) {
    if (typeof value.__suiteEntity === 'string') found.add(value.__suiteEntity)
    else for (const child of Object.values(value)) refsIn(child, found)
  }
  return found
}

function removeEntityReference(value: Normalized, key: string): Normalized {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(isObject(item) && item.__suiteEntity === key))
      .map((item) => removeEntityReference(item, key))
  }
  if (!isObject(value) || typeof value.__suiteEntity === 'string') return value
  return Object.fromEntries(
    Object.entries(value).map(([field, child]) => [field, removeEntityReference(child, key)]),
  )
}

function replaceReference(record: QueryRecord, oldKey: string, newKey: string): void {
  const replace = (value: Normalized): Normalized => {
    if (Array.isArray(value)) return value.map(replace)
    if (!isObject(value)) return value
    if (value.__suiteEntity === oldKey) return { __suiteEntity: newKey }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]))
  }
  record.normalized = replace(record.normalized)
  record.pages = record.pages.map(replace)
}

function finalOperation(descriptor: MutationDescriptor | UploadDescriptor): Operation {
  return descriptor.kind === 'upload' ? descriptor.finish : descriptor.operation
}

function platformError(cause: unknown): PlatformError {
  if (cause instanceof TransportError) {
    return { ...cause.details, type: cause.type, message: cause.message, status: cause.status }
  }
  if (isObject(cause)) {
    return {
      ...cause,
      type: typeof cause.type === 'string' ? cause.type : 'RequestError',
      message: typeof cause.message === 'string' ? cause.message : 'Request failed',
      status: typeof cause.status === 'number' ? cause.status : 0,
    }
  }
  return { type: 'RequestError', message: String(cause ?? 'Request failed'), status: 0 }
}

function isSilent(error: PlatformError, silent?: boolean | readonly string[]): boolean {
  return silent === true || (Array.isArray(silent) && silent.includes(error.type))
}

function browserPersistence(): EntityPersistence | false {
  if (typeof indexedDB === 'undefined') return false
  return {
    async load() {
      return (await idbGet<PersistedEntity[]>(PERSISTENCE_KEY)) ?? []
    },
    save(entities) {
      return idbSet(PERSISTENCE_KEY, entities)
    },
  }
}

function assertOperation(operation: Operation): void {
  if (!operation?.id || !operation.method || !operation.path || !operation.owner) {
    throw new TypeError('Malformed operation descriptor')
  }
}

function assertDescriptor(descriptor: ReadDescriptor): void {
  if (descriptor.kind !== 'query' && descriptor.kind !== 'infinite') {
    throw new TypeError('Malformed query descriptor')
  }
  assertOperation(descriptor.operation)
}

function assertMutationDescriptor(descriptor: MutationDescriptor | UploadDescriptor): void {
  if (descriptor.kind === 'mutation') assertOperation(descriptor.operation)
  else if (descriptor.kind === 'upload') {
    assertOperation(descriptor.create)
    assertOperation(descriptor.chunk)
    assertOperation(descriptor.finish)
  } else throw new TypeError('Malformed mutation descriptor')
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // Vue reactive proxies are cloned through their JSON-compatible shape below.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function isAbort(error: unknown): boolean {
  return isObject(error) && error.name === 'AbortError'
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

const singleton = createServerState({
  transport: defaultTransport,
  realtime: import.meta.env.MODE === 'test' ? false : undefined,
})

export const useQuery = singleton.useQuery
export const useMutation = singleton.useMutation
export const invalidateAll = singleton.invalidateAll
export const onChallenge = singleton.onChallenge
export const serverState = singleton

function defaultMutationErrorReporter(error: PlatformError): void {
  void import('@/platform/feedback').then(({ reportMutationError }) => reportMutationError(error))
}
