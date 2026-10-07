/** Ordinary writes run in call order; challenge resolution releases the queue. */
import { TransportError, type MutationRef, type Transport } from '@/platform/transport'

import { recordMutationFailure } from './errors'
import { canceled, isAbort, type Reads } from './reads'
import type { ChallengeHandler, OwnerRegistration, WriteOptions } from './types'

export class Writes {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly challenges = new Map<string, ChallengeHandler>()
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(
    private readonly transport: Transport,
    private readonly reads: Reads,
    private readonly feedback: (error: Error) => void,
  ) {}

  async run<I, O>(
    reference: MutationRef<I, O>,
    input: I,
    registration: Promise<OwnerRegistration>,
    options: WriteOptions = {},
  ): Promise<O> {
    const attempt = async () => {
      options.signal?.throwIfAborted()
      const owner = await registration
      options.signal?.throwIfAborted()
      const policy = owner.policy(reference)
      if (policy.effects === undefined)
        throw new TypeError(`Missing mutation effects: ${reference.owner}.${reference.id}`)
      const effects = policy.effects === 'none' ? {} : policy.effects
      const touched = effects.touches?.(input) ?? []
      const partition = this.reads.access(policy, input, options.context)
      const optimisticReads = this.reads.optimistic(partition, input, effects.optimisticReads)
      const rollback = this.reads.entities.optimistic(
        partition,
        reference.entity?.tag,
        input,
        touched,
        effects.optimistic,
      )
      try {
        const operation = policy.operation?.(reference, input) ?? reference
        const output = await canceled(
          this.transport.request(operation, input, {
            signal: options.signal,
            context: options.context,
            keepalive: options.keepalive,
          }),
          options.signal,
        )
        options.signal?.throwIfAborted()
        if (partition !== this.reads.access(policy, input, options.context))
          throw new DOMException('Aborted', 'AbortError')
        optimisticReads.commit()
        this.reads.commit(output, reference.entity, partition)
        const invalidates =
          typeof effects.invalidates === 'function'
            ? effects.invalidates(input)
            : (effects.invalidates ?? [])
        this.reads.changed(
          touched,
          invalidates,
          effects.matches ? (queryInput) => effects.matches!(input, queryInput) : undefined,
        )
        effects.settled?.(input, output)
        for (const id of touched)
          for (const listener of this.listeners.get(id) ?? []) {
            try {
              listener()
            } catch (cause) {
              console.error(cause)
            }
          }
        return output
      } catch (cause) {
        optimisticReads.rollback()
        rollback()
        throw cause
      }
    }
    try {
      return await canceled(this.enqueue(attempt), options.signal)
    } catch (cause) {
      if (isAbort(cause)) throw cause
      const challenge =
        cause instanceof TransportError ? this.challenges.get(cause.type) : undefined
      if (challenge) {
        try {
          // Unlock can itself be a queued mutation. Each explicit retry rejoins in call order.
          const output = await canceled(
            challenge(cause instanceof Error ? cause : new Error(String(cause)), () =>
              this.enqueue(attempt),
            ),
            options.signal,
          )
          if (output !== undefined) return output as O
        } catch (error) {
          if (isAbort(error)) throw error
          // A declined challenge keeps the original refusal.
        }
      }
      options.signal?.throwIfAborted()
      recordMutationFailure(cause)
      if (!options.silent && cause instanceof Error) this.feedback(cause)
      throw cause
    }
  }

  private enqueue<O>(attempt: () => Promise<O>): Promise<O> {
    const work = this.tail.then(attempt, attempt)
    this.tail = work.catch(() => {})
    return work
  }

  onTouch(id: string, listener: () => void): () => void {
    let listeners = this.listeners.get(id)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(id, listeners)
    }
    listeners.add(listener)
    const current = listeners
    return () => {
      current.delete(listener)
      if (!current.size) this.listeners.delete(id)
    }
  }

  onChallenge(type: string, handler: ChallengeHandler): () => void {
    this.challenges.set(type, handler)
    return () => {
      if (this.challenges.get(type) === handler) this.challenges.delete(type)
    }
  }
}
