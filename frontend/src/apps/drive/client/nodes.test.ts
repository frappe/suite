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
  it('discovers the Personal Root before posting the content node', async () => {
    const calls: Array<{ id: string; input: any }> = []
    const state = createServerState({
      realtime: false,
      persistence: false,
      transport: {
        async request(operation, input) {
          operation.validateInput?.(input)
          calls.push({ id: operation.id, input: structuredClone(input) })
          if (operation.id === 'roots_discover') {
            return { personal: { node: 'personal-root', title: 'Me' }, organization: null } as never
          }
          return {
            name: 'new-node', title: 'Untitled presentation', kind: 'document', parent: 'personal-root',
          } as never
        },
      },
    })
    const mutation = state.useMutation(createDocument())
    await mutation.run({ content_doctype: 'Presentation' })
    expect(calls.map((call) => call.id)).toEqual(['roots_discover', 'node_create'])
    expect(calls[1]?.input).toMatchObject({
      parent: 'personal-root', title: 'Untitled presentation', kind: 'document', content_doctype: 'Presentation',
    })
    expect(calls[1]?.input).not.toHaveProperty('upload')
    state.dispose()
  })
})
