/** An owner can require a domain node for an operation whose URL names a satellite. */
import type { MutationRef, Validators } from './index'

export function coveredMutation<I, O, E extends string>(
  reference: MutationRef<I, O, E>,
): MutationRef<I & { node: string }, O, E> {
  return {
    ...reference,
    types: undefined,
    localParams: ['node'],
    loadValidators: async () => {
      const validators: Validators<I, O> | undefined = await reference.loadValidators?.()
      return {
        validateInput(value: unknown): asserts value is I & { node: string } {
          if (
            typeof value !== 'object' ||
            value === null ||
            !('node' in value) ||
            typeof value.node !== 'string' ||
            !value.node
          )
            throw new TypeError('A covered node is required')
          const { node: _node, ...input } = value
          validators?.validateInput(input)
        },
        validateOutput(value: unknown): asserts value is O {
          validators?.validateOutput(value)
        },
      }
    },
  }
}
