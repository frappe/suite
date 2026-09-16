import { describe, expect, it } from 'vitest'

import { api } from './__fixtures__/generated'

describe('generated contract fixture', () => {
  it('emits nested operations and runtime input validators', () => {
    expect(api.node_patch.rename).toMatchObject({
      method: 'PATCH', path: 'nodes/{node}', nodeParams: ['node'],
      entity: { tag: 'Drive Node', id: 'name', version: 'modified' },
    })
    expect(() => api.node_get.validateInput?.({ expand: [] })).toThrow(/node is required/)
    expect(() => api.node_get.validateInput?.({ node: 'n1', extra: true })).toThrow(/not allowed/)
    expect(() => api.node_get.validateInput?.({ node: 'n1', expand: ['breadcrumbs'] })).not.toThrow()
  })
})
