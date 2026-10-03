import type { Operation } from '@/platform/transport'

import { driveLinks } from './links'

/**
 * Add the entity declaration the generated schema cannot express yet, and the
 * share-link codes each request needs. The generated input validator stays
 * on: every Drive route declares its input, so a request it refuses is a bug.
 *
 * A request sends the codes of the nodes it names: its path nodes, `parent_node`,
 * `nodes` and `patch.parent_node`, plus the `covers` nodes, such as the document a
 * comment request belongs to.
 */
export function driveOperation<Input, Output>(
  operation: Operation<any, any>,
  options: { entity?: boolean; covers?: readonly string[] } = {},
): Operation<Input, Output> {
  const nodeParams = operation.nodeParams ?? []
  const covers = options.covers ?? []
  // Only a read of the node itself can say the node is gone.
  const readsNode = operation.method === 'GET' && operation.path === 'nodes/{node}'
  return {
    ...operation,
    ...(options.entity
      ? { entity: { tag: 'DriveNode', id: 'name', version: 'modified', doctype: 'Drive Node' } }
      : {}),
    scope: (input: Input) =>
      driveLinks.scope([...covers, ...namedNodes(input, nodeParams)], {
        returnsNodes: options.entity,
        subject: readsNode ? nodeParam(input) : undefined,
      }),
  } as Operation<Input, Output>
}

function namedNodes(input: unknown, nodeParams: readonly string[]): string[] {
  if (typeof input !== 'object' || input === null) return []
  const record = input as Record<string, unknown>
  const patch = typeof record.patch === 'object' && record.patch !== null ? (record.patch as Record<string, unknown>) : {}
  const named = [...nodeParams.map((name) => record[name]), record.parent_node, patch.parent_node]
  if (Array.isArray(record.nodes)) named.push(...record.nodes)
  return named.filter((value): value is string => typeof value === 'string' && value !== '')
}

function nodeParam(input: unknown): string | undefined {
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).node : undefined
  return typeof value === 'string' ? value : undefined
}
