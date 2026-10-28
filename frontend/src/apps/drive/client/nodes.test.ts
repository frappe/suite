import { describe, expect, it, vi } from 'vitest'

import { client } from '@/api'

import { createDocument, hasDefaultDocumentTitle, nodeContentUrl } from './nodes'

vi.mock('@/api', () => ({
  api: { drive: { nodes: { createDocument: 'drive.nodes.createDocument' } } },
  client: { mutation: vi.fn() },
}))

describe('new document', () => {
  const mutation = vi.mocked(client.mutation)

  it('asks Drive for the default title in one request, and lets Drive number a taken one', async () => {
    mutation.mockReset()
    mutation.mockResolvedValueOnce({ name: 'n2', title: 'Untitled spreadsheet (2)' })
    const node = await createDocument({ parent_node: 'home', content_doctype: 'Sheet' })
    expect(node).toEqual({ name: 'n2', title: 'Untitled spreadsheet (2)' })
    expect(mutation.mock.calls.map(([, input]) => input)).toEqual([
      {
        kind: 'document',
        parent_node: 'home',
        content_doctype: 'Sheet',
        title: 'Untitled spreadsheet',
        deduplicate_title: true,
      },
    ])
  })
})

describe('default document title', () => {
  it('is recognised on the title Drive gives a new Writer document, and only until it is renamed', async () => {
    expect(hasDefaultDocumentTitle('Untitled document')).toBe(true)
    expect(hasDefaultDocumentTitle('Quarterly plan')).toBe(false)
  })
})

describe('content URL', () => {
  it('opens a file in place by default and asks for a save only when told to', () => {
    expect(nodeContentUrl('a/b')).toBe('/api/suite/drive/nodes/a%2Fb/content')
    expect(nodeContentUrl('n1', { download: true, revision: 2 })).toBe(
      '/api/suite/drive/nodes/n1/content?download=1&v=2',
    )
  })
})
