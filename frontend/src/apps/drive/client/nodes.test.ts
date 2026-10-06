import { describe, expect, it } from 'vitest'

import { hasDefaultDocumentTitle, nodeContentUrl } from './nodes'

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
