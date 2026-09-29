import { describe, expect, it } from 'vitest'
import { createServerState } from '@/platform/server-state'
import { children, createDocument } from './nodes'

describe('children descriptors', () => {
  it('resets the cursor when server presentation changes', () => {
    const first = children({ node: 'p', cursor: 'opaque', order_by: 'title', ascending: true })
    const changed = children({ node: 'p', order_by: 'modified', ascending: false, group_by: 'owner' })
    expect(changed.input.cursor).toBeUndefined()
    expect(changed.input).not.toEqual(first.input)
  })
})

describe('generic document creation', () => {
  it('posts one content node with its type default title into the given parent', async () => {
    const calls: Array<{ id: string; input: unknown }> = []
    const state = createServerState({
      realtime: false,
      persistence: false,
      transport: {
        async request(operation, input) {
          operation.validateInput?.(input)
          calls.push({ id: operation.id, input: structuredClone(input) })
          return {
            name: 'new-node', title: 'Untitled presentation', kind: 'document', parent: 'folder-1',
          } as never
        },
      },
    })
    const mutation = state.useMutation(createDocument())
    await mutation.run({ parent: 'folder-1', content_doctype: 'Presentation' })
    expect(calls).toEqual([{
      id: 'node_create',
      input: { parent: 'folder-1', title: 'Untitled presentation', kind: 'document', content_doctype: 'Presentation' },
    }])
    state.dispose()
  })
})
