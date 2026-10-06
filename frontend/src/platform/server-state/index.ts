/** Product-neutral API engine. Owners register scope and effects once, lazily. */
import type { Realtime } from '@/platform/realtime'
import {
  transport as defaultTransport,
  type MutationRef,
  type PageRef,
  type QueryRef,
  type TransferRef,
  type Transport,
} from '@/platform/transport'

import { Entities } from './entities'
import { mutationObserver, observe } from './observers'
import { identityPartition } from './partition'
import { Reads } from './reads'
import type {
  CallArgs,
  InfiniteQueryState,
  MutationState,
  ObserveArgs,
  OwnerLoader,
  OwnerRegistration,
  ReadOptions,
  UploadState,
  WriteOptions,
} from './types'
import { Writes } from './writes'

export type {
  QueryState,
  InfiniteQueryState,
  MutationState,
  UploadState,
  OwnerRegistration,
  Policy,
  Effects,
  TransferContext,
} from './types'
export interface ClientOptions {
  transport?: Transport
  realtime?: Realtime | false
  persistence?: boolean
  identity?: string | null
  feedback?: (error: Error) => void
}

export function createApiClient(
  loaders: Readonly<Record<string, OwnerLoader>>,
  options: ClientOptions = {},
) {
  const feedback = options.feedback ?? reportError
  const transport = options.transport ?? defaultTransport
  const entities = new Entities(options.persistence ?? true)
  const reads = new Reads(
    transport,
    entities,
    options.realtime,
    identityPartition(options.identity),
  )
  const writes = new Writes(transport, reads, options.feedback ?? reportError)
  const owners = new Map<string, Promise<OwnerRegistration>>()
  const cleanup: Array<() => void> = []
  function owner(name: string): Promise<OwnerRegistration> {
    const loader = loaders[name]
    if (!loader) return Promise.reject(new TypeError(`No API registration for ${name}`))
    let pending = owners.get(name)
    if (!pending) {
      pending = loader()
      owners.set(name, pending)
    }
    return pending
  }
  const client = {
    async query<I, O>(reference: QueryRef<I, O>, ...args: CallArgs<I, ReadOptions>): Promise<O> {
      if (reference.kind !== 'query') throw new TypeError('Expected a query reference')
      const input = (args[0] ?? {}) as I
      const request = args[1] ?? {}
      request.signal?.throwIfAborted()
      const registration = await owner(reference.owner)
      const record = reads.record(
        reference,
        input,
        registration.policy(reference),
        false,
        request.context,
      )
      return (await reads.fetch(record, input, request)) as O
    },
    mutation<I, O>(reference: MutationRef<I, O>, ...args: CallArgs<I, WriteOptions>): Promise<O> {
      if (reference.kind !== 'mutation')
        return Promise.reject(new TypeError('Expected a mutation reference'))
      return writes.run(reference, (args[0] ?? {}) as I, owner(reference.owner), args[1])
    },
  }
  function useQuery<I, O>(reference: QueryRef<I, O>, ...args: ObserveArgs<I>) {
    if (reference.kind !== 'query') throw new TypeError('Expected a query reference')
    return observe(reads, owner(reference.owner), reference, args[0], false).query
  }
  function useInfiniteQuery<I, Row, O>(
    reference: PageRef<I, Row, string, O>,
    ...args: ObserveArgs<I>
  ): InfiniteQueryState<Row> {
    if (reference.kind !== 'query' || !reference.page)
      throw new TypeError('Expected a page reference')
    return observe(reads, owner(reference.owner), reference, args[0], true)
      .infinite as InfiniteQueryState<Row>
  }
  function useMutation<I, O>(
    reference: MutationRef<I, O>,
    options: Omit<WriteOptions, 'signal'> = {},
  ): MutationState<I, O> {
    return mutationObserver((input: I, signal) =>
      writes.run(reference, input, owner(reference.owner), { ...options, signal }),
    ) as MutationState<I, O>
  }
  function useUpload<I, O>(
    reference: TransferRef<I, O>,
    options: { silent?: boolean } = {},
  ): UploadState<I, O> {
    return mutationObserver(async (input: I, signal, progress) => {
      const registration = await owner(reference.owner)
      signal.throwIfAborted()
      if (!registration.transfer) throw new TypeError(`Missing transfer: ${reference.id}`)
      progress(0)
      try {
        return await registration.transfer(reference, input, {
          signal,
          progress,
          client,
          transport,
        })
      } catch (cause) {
        if (!signal.aborted && !options.silent && cause instanceof Error) feedback(cause)
        throw cause
      }
    }) as UploadState<I, O>
  }
  if (typeof window !== 'undefined') {
    const refresh = () => reads.invalidate(() => true)
    const visible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visible)
    cleanup.push(() => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visible)
    })
  }
  if (options.realtime) {
    const realtime = options.realtime
    cleanup.push(realtime.onReconnect(() => reads.invalidate(() => true)))
    for (const event of ['doc_update', 'doc_rename', 'list_update']) {
      cleanup.push(
        realtime.subscribe<{ doctype: string; name?: string }>(event, (value) =>
          reads.invalidate(
            (reference) =>
              reference.entity?.tag.replaceAll(' ', '').toLowerCase() ===
              value.doctype.replaceAll(' ', '').toLowerCase(),
          ),
        ),
      )
    }
    cleanup.push(
      realtime.subscribe('drive:changed', () =>
        reads.invalidate((reference) => reference.owner === 'drive'),
      ),
    )
  }
  return {
    client,
    useQuery,
    useMutation,
    useInfiniteQuery,
    useUpload,
    onTouch: writes.onTouch.bind(writes),
    onChallenge: writes.onChallenge.bind(writes),
    resetIdentity: (identity?: string | null) =>
      reads.switchPartition(identityPartition(identity, true)),
    invalidate: reads.invalidate.bind(reads),
    dispose() {
      for (const stop of cleanup) stop()
      reads.dispose()
    },
  }
}

function reportError(error: Error): void {
  void import('@/platform/feedback').then(({ reportMutationError }) => reportMutationError(error))
}
