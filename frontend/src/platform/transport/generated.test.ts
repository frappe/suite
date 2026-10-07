import { describe, expect, it } from 'vitest'

import { api } from './__fixtures__/generated'

describe('generated contract fixture', () => {
  it('emits nested operations and lazy typed input validators', async () => {
    const validators = await api.nodes.get.loadValidators?.()
    expect(api.nodes.rename).toMatchObject({
      method: 'PATCH',
      path: 'nodes/{node}',
      nodeParams: ['node'],
      entity: { tag: 'Drive Node', id: 'name', version: 'modified' },
    })
    expect(() => validators?.validateInput({ expand: [] })).toThrow(/node is required/)
    expect(() => validators?.validateInput({ node: 'n1', extra: true })).toThrow(/not allowed/)
    expect(() => validators?.validateInput({ node: 'n1', expand: ['breadcrumbs'] })).not.toThrow()
  })
})
