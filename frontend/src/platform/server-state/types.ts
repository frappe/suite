import type { MaybeRefOrGetter } from 'vue'

import type {
  MutationRef,
  Operation,
  QueryRef,
  RequestContext,
  TransferRef,
  Transport,
} from '@/platform/transport'

export type ObserveArgs<I> =
  Record<never, never> extends I
    ? [input?: MaybeRefOrGetter<NoInfer<I> | false>]
    : [input: MaybeRefOrGetter<NoInfer<I> | false>]
export interface ReadOptions {
  context?: RequestContext
  cache?: 'prefer'
  signal?: AbortSignal
}
export interface WriteOptions {
  context?: RequestContext
  keepalive?: boolean
  silent?: boolean
  signal?: AbortSignal
}
export type CallArgs<I, Options> =
  Record<never, never> extends I
    ? [input?: NoInfer<I>, options?: Options]
    : [input: NoInfer<I>, options?: Options]
export interface QueryState<T> {
  readonly data: T | undefined
  readonly status: 'pending' | 'success' | 'error'
  readonly isFetching: boolean
  readonly error: Error | null
  refetch(): Promise<T | undefined>
  cancel(): void
}
export interface InfiniteQueryState<Row> {
  readonly status: 'pending' | 'success' | 'error'
  readonly isFetching: boolean
  refetch(): Promise<void>
  readonly rows: readonly Row[]
  readonly total: number | undefined
  readonly hasNext: boolean
  readonly isFetchingNext: boolean
  readonly error: Error | null
  fetchNext(): Promise<void>
  cancel(): void
}
export interface MutationState<I, O> {
  readonly isPending: boolean
  readonly error: Error | null
  run(
    ...args: Record<never, never> extends I ? [input?: NoInfer<I>] : [input: NoInfer<I>]
  ): Promise<O>
  reset(): void
  cancel(): void
}
export interface UploadState<I, O> extends MutationState<I, O> {
  readonly progress: number | null
}
export interface Effects<I = unknown> {
  touches?: (input: I) => readonly string[]
  optimistic?: (input: I, entity: Record<string, unknown>) => Record<string, unknown> | void
  optimisticReads?: {
    references: readonly string[]
    update(input: I, queryInput: unknown, data: unknown): unknown
  }
  invalidates?: readonly string[] | ((input: I) => readonly string[])
  matches?: (input: I, queryInput: unknown) => boolean
  settled?: (input: I, output: unknown) => void
}
export interface Policy<I = unknown, O = unknown> {
  operation?: (reference: Operation<I, O>, input: I) => Operation<I, O>
  partition?: (input: I) => string
  staleTime?: number
  refetchInterval?: number
  member?: (row: Record<string, unknown>, input: I) => boolean
  effects?: Effects<I> | 'none'
}
export interface TransferContext {
  signal: AbortSignal
  progress(value: number): void
  client: ImperativeClient
  transport: Transport
}
export interface OwnerRegistration {
  policy<I, O>(reference: Operation<I, O>): Policy<I, O>
  transfer?<I, O>(reference: TransferRef<I, O>, input: I, context: TransferContext): Promise<O>
}
export type OwnerLoader = () => Promise<OwnerRegistration>
export interface ImperativeClient {
  query<I, O>(reference: QueryRef<I, O>, ...args: CallArgs<I, ReadOptions>): Promise<O>
  mutation<I, O>(reference: MutationRef<I, O>, ...args: CallArgs<I, WriteOptions>): Promise<O>
}
export type ChallengeHandler = (error: Error, retry: () => Promise<unknown>) => Promise<unknown>
