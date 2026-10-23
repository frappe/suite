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
      return (await refresh()) as O | undefined
    },
    cancel() {
      stopped = true
      detach()
    },
  })
  const page = reference as QueryRef<I, O> & { page: PageCapability }
  function materializedPages() {
    return (current.value?.pages ?? []).map((value) => reads.entities.materialize(value))
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
      return materializedPages().flatMap((value) =>
        isRecord(value) && Array.isArray(value[page.page.rows])
          ? (value[page.page.rows] as unknown[])
          : [],
      )
    },
    get hasNext() {
      const last = materializedPages().at(-1)
      if (!isRecord(last)) return false
      if ('cursor' in page.page)
        return last[page.page.next] !== null && last[page.page.next] !== undefined
      if ('more' in page.page) return last[page.page.more] === true
      const offset = isRecord(input())
        ? Number((input() as Record<string, unknown>)[page.page.offset] ?? 0)
        : 0
      return (
        Array.isArray(last[page.page.rows]) &&
        (last[page.page.rows] as unknown[]).length > 0 &&
        offset + infinite.rows.length < Number(last[page.page.total])
      )
    },
    get total() {
      const last = materializedPages().at(-1)
      return 'total' in page.page && isRecord(last) && typeof last[page.page.total] === 'number'
        ? (last[page.page.total] as number)
        : undefined
    },
    get isFetchingNext() {
      return current.value?.fetchingNext ?? false
    },
    get error() {
      return query.error
    },
    async fetchNext() {
      if (disposed || stopped || input() === false) return
      await owner
      const record = current.value
      if (!record || !infinite.hasNext || record.fetchingNext || record.fetching) return
      const last = materializedPages().at(-1)
      const value = input()
      if (!isRecord(last) || !isRecord(value)) return
      const run = generation
      const next =
        'cursor' in page.page
          ? { ...value, [page.page.cursor]: last[page.page.next] }
          : {
              ...value,
              [page.page.offset]: Number(value[page.page.offset] ?? 0) + infinite.rows.length,
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
  const state = reactive({
    pending: 0,
    error: null as Error | null,
    progress: null as number | null,
  })
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
    async run(input: I = {} as I): Promise<O> {
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
