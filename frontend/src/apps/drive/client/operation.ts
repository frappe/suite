import type { Operation } from '@/platform/transport'

/** Add the entity declaration and local body type that the generated schema cannot express yet. */
export function driveOperation<Input, Output>(
  operation: Operation<any, any>,
  options: { entity?: boolean; looseInput?: boolean } = {},
): Operation<Input, Output> {
  return {
    ...operation,
    ...(options.entity
      ? { entity: { tag: 'DriveNode', id: 'name', version: 'modified', doctype: 'Drive Node' } }
      : {}),
    ...(options.looseInput ? { validateInput: undefined } : {}),
  } as Operation<Input, Output>
}

