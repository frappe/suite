import { describe, expect, it } from 'vitest'

import { createServerState } from '@/platform/server-state'

import { children, createDocument, hasDefaultDocumentTitle } from './nodes'

describe('children descriptors', () => {
  it('resets the cursor when server presentation changes', () => {
    const first = children({ node: 'p', cursor: 'opaque', order_by: 'title', ascending: true })
    const changed = children({ node: 'p', order_by: 'modified', ascending: false })
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
            name: 'new-node',
            title: 'Untitled presentation',
            kind: 'document',
            parent_node: 'folder-1',
          } as never
        },
      },
    })
    const mutation = state.useMutation(createDocument())
    await mutation.run({ parent_node: 'folder-1', content_doctype: 'Presentation' })
    expect(calls).toEqual([
      {
        id: 'node_create.create_document',
        input: {
          parent_node: 'folder-1',
          title: 'Untitled presentation',
          kind: 'document',
          content_doctype: 'Presentation',
        },
      },
    ])
    state.dispose()
  })
})

describe('default document title', () => {
  it('is recognised on the title Drive gives a new Writer document, and only until it is renamed', async () => {
    const titles: unknown[] = []
    const state = createServerState({
      realtime: false,
      persistence: false,
      transport: {
        async request(_operation, input) {
          titles.push((input as { title?: unknown }).title)
          return { name: 'new-node', title: 'x', kind: 'document', parent_node: 'p' } as never
        },
      },
    })
    await state
      .useMutation(createDocument())
      .run({ parent_node: 'p', content_doctype: 'Writer Document' })
    state.dispose()

    expect(titles).toHaveLength(1)
    expect(hasDefaultDocumentTitle(titles[0] as string)).toBe(true)
    expect(hasDefaultDocumentTitle('Quarterly plan')).toBe(false)
  })
})
