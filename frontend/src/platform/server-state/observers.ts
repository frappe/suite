/** Vue observers follow arguments and access partitions and detach on scope disposal. */
import {
  getCurrentScope,
  onScopeDispose,
  reactive,
  shallowReactive,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

import type { PageCapability, QueryRef } from '@/platform/transport'

import { isRecord } from './entities'
import { asError, canceled, canonical, isAbort, type ReadRecord, type Reads } from './reads'
import type { InfiniteQueryState, OwnerRegistration, QueryState } from './types'

export function observe<I, O>(
  reads: Reads,
  owner: Promise<OwnerRegistration>,
  reference: QueryRef<I, O>,
  source: MaybeRefOrGetter<I | false> | undefined,
  paging: boolean,
) {
  const registration = shallowRef<OwnerRegistration>()
  const current = shallowRef<ReadRecord>()
  const error = shallowRef<Error | null>(null)
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let generation = 0
  let disposed = false
  let stopped = false

  // SAFETY: useQuery/useInfiniteQuery expose ObserveArgs<I>, which permits omitted
  // source only when an empty input satisfies I; false is kept as the disabled state.
  const input = () => toValue(source) ?? ({} as I)
  async function refresh(): Promise<unknown> {
    if (disposed || input() === false) return undefined
    if (stopped) {
      stopped = false
      attach()
    }
    await owner
    const record = current.value
    const signal = controller?.signal
    if (!record || !signal) return undefined
    if (paging) {
      await reads.refreshPages(record, signal)
      return record.value
    }
    return reads.fetch(record, record.input, { signal })
  }
  function detach() {
    generation += 1
    controller?.abort()
    controller = undefined
    if (timer) clearInterval(timer)
    timer = undefined
    if (current.value) reads.release(current.value, revalidate)
    current.value = undefined
  }
  function revalidate() {
    void refresh().catch(() => {})
  }
  function attach() {
    detach()
    const value = input()
    if (disposed || stopped || value === false || !registration.value) return
    const policy = registration.value.policy(reference)
    const record = reads.record(reference, value, policy, paging)
    current.value = record
    controller = new AbortController()
    reads.retain(record, revalidate, paging)
    void (
      paging
        ? reads.refreshPages(record, controller.signal)
        : reads.fetch(record, record.input, { signal: controller.signal, cache: 'prefer' })
    ).catch(() => {})
    if (policy.refetchInterval) timer = setInterval(revalidate, policy.refetchInterval)
  }
  const stop = watch(
    () => {
      const value = input()
      const policy = registration.value?.policy(reference)
      return JSON.stringify([
        Boolean(registration.value),
        canonical(value),
        reads.partition.value,
        value === false ? null : policy?.partition?.(value),
      ])
    },
    () => {
      stopped = false
      attach()
    },
    { immediate: true, flush: 'sync' },
  )
  void owner
    .then((value) => {
      if (!disposed) registration.value = value
    })
    .catch((cause) => {
      if (!disposed) error.value = asError(cause)
    })
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true
      stop()
      detach()
    })

  const query: QueryState<O> = shallowReactive({
    get data() {
      // SAFETY: this observer attaches only to the read record for reference; its output
      // validators run in transport before normalization, and materialization reverses normalization.
      return current.value ? (reads.entities.materialize(current.value.value) as O) : undefined
    },
    get status() {
      return error.value ? ('error' as const) : (current.value?.status ?? 'pending')
    },
    get isFetching() {
      return (current.value?.fetching ?? 0) > 0
    },
    get error() {
      return error.value ?? current.value?.error ?? null
    },
    async refetch() {
      // SAFETY: refresh fetches this same reference; transport validates O before caching it.
      return (await refresh()) as O | undefined
    },
    cancel() {
      stopped = true
      detach()
    },
  })
  const page: QueryRef<I, O> & { page?: PageCapability } = reference
  function materializedPages() {
    return (current.value?.pages ?? []).map((value) => reads.entities.materialize(value))
  }
  /** Every row the loaded pages hold. Offset paging counts these. */
  function loadedRows(): unknown[] {
    const definition = page.page
    if (!definition) return []
    return materializedPages().flatMap((value) => {
      const rows = isRecord(value) ? value[definition.rows] : undefined
      return Array.isArray(rows) ? rows : []
    })
  }
  const infinite: InfiniteQueryState<unknown> = reactive({
    get status() {
      return query.status
    },
    get isFetching() {
      return query.isFetching
    },
    async refetch() {
      await query.refetch()
    },
    get rows() {
      const rows = loadedRows()
      // A row a pending write took out of the listing hides at once. The pages keep it,
      // so paging still counts it and a rollback shows it in its place.
      const record = current.value
      const member = record?.policy.member
      if (!record || !member) return rows
      return rows.filter((row) => !isRecord(row) || member(row, record.input))
    },
    get hasNext() {
      const last = materializedPages().at(-1)
      if (!page.page || !isRecord(last)) return false
      if ('cursor' in page.page)
        return last[page.page.next] !== null && last[page.page.next] !== undefined
      if ('more' in page.page) return last[page.page.more] === true
      const value = input()
      const offset = isRecord(value) ? Number(value[page.page.offset] ?? 0) : 0
      const rows = last[page.page.rows]
      return (
        Array.isArray(rows) &&
        rows.length > 0 &&
        offset + loadedRows().length < Number(last[page.page.total])
      )
    },
    get total() {
      const last = materializedPages().at(-1)
      const total =
        page.page && 'total' in page.page && isRecord(last) ? last[page.page.total] : undefined
      return typeof total === 'number' ? total : undefined
    },
    get isFetchingNext() {
      return current.value?.fetchingNext ?? false
    },
    get error() {
      // Revalidating loaded pages must not erase a failed continuation.
      // Only explicitly fetching that window again clears its retry state.
      return current.value?.nextError ?? query.error
    },
    async fetchNext() {
      if (disposed || stopped || input() === false) return
      await owner
      const record = current.value
      if (!record || !infinite.hasNext || record.fetchingNext || record.fetching) return
      const last = materializedPages().at(-1)
      const value = input()
      if (!page.page || !isRecord(last) || !isRecord(value)) return
      const run = generation
      const next =
        'cursor' in page.page
          ? { ...value, [page.page.cursor]: last[page.page.next] }
          : {
              ...value,
              [page.page.offset]: Number(value[page.page.offset] ?? 0) + loadedRows().length,
            }
      await reads.fetch(record, next, { signal: controller?.signal }, true)
      if (run !== generation) return
    },
    cancel: query.cancel,
  })
  return { query, infinite }
}

export function mutationObserver<I, O>(
  execute: (input: I, signal: AbortSignal, progress: (value: number) => void) => Promise<O>,
) {
  interface MutationProgress {
    pending: number
    error: Error | null
    progress: number | null
  }
  const state = reactive<MutationProgress>({ pending: 0, error: null, progress: null })
  const controllers = new Set<AbortController>()
  let generation = 0
  const result = {
    get isPending() {
      return state.pending > 0
    },
    get error() {
      return state.error
    },
    get progress() {
      return state.progress
    },
    async run(
      ...args: Record<never, never> extends I ? [input?: NoInfer<I>] : [input: NoInfer<I>]
    ): Promise<O> {
      const provided = args[0]
      // SAFETY: this conditional argument tuple permits omission only when an empty object satisfies I.
      const input = provided === undefined ? ({} as I) : provided
      const run = ++generation
      const controller = new AbortController()
      controllers.add(controller)
      state.pending += 1
      state.error = null
      state.progress = null
      try {
        return await canceled(
          execute(input, controller.signal, (value) => {
            if (run === generation) state.progress = value
          }),
          controller.signal,
        )
      } catch (cause) {
        if (!isAbort(cause) && !controller.signal.aborted && run === generation)
          state.error = asError(cause)
        throw cause
      } finally {
        controllers.delete(controller)
        state.pending -= 1
      }
    },
    reset() {
      generation += 1
      state.error = null
      state.progress = null
    },
    cancel() {
      for (const controller of controllers) controller.abort()
    },
  }
  if (getCurrentScope()) onScopeDispose(result.cancel)
  return result
}
