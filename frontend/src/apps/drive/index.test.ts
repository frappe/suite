import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import type { Operation } from '@/platform/transport'

// A Drive server with one PDF and one Writer document, which records each request.
const server = vi.hoisted(() => ({ requests: [] as string[] }))

vi.mock('@/platform/transport', async (actual) => ({
  ...(await actual<typeof import('@/platform/transport')>()),
  transport: {
    request: async (operation: Operation, input: { node: string }) => {
      server.requests.push(`${operation.id} ${input.node}`)
      if (operation.id !== 'node_get') return {}
      const document = input.node === 'brief'
      return {
        name: input.node,
        title: document ? 'Brief' : 'Plan.pdf',
        kind: document ? 'document' : 'file',
        parent_node: 'p',
        root: 'r',
        state: 'Active',
        trash_root: null,
        size: 1,
        mime: document ? null : 'application/pdf',
        url: document ? null : '/f/plan',
        content_doctype: document ? 'Writer Document' : null,
        content_docname: document ? 'WD-1' : null,
        is_template: 0,
        owner: { id: 'asha@example.com', full_name: 'Asha', user_image: null },
        creation: null,
        modified: null,
        content_modified: null,
        access: { role: 10, via_link: null },
        breadcrumbs: [{ name: 'p', title: 'Projects', kind: 'folder' }],
      }
    },
  },
}))

const { openDocumentSession, useDriveDocumentLocation } = await import('./index')

describe('Opening a node', () => {
  it('opens a file preview or a document from one read of the node', async () => {
    const file = await openDocumentSession('plan')
    expect(file.contentDoctype).toBe('File')
    const document = await openDocumentSession('brief')
    expect([document.contentDoctype, document.contentDocname]).toEqual(['Writer Document', 'WD-1'])

    expect(server.requests.filter((request) => request.startsWith('node_get'))).toEqual([
      'node_get plan',
      'node_get brief',
    ])
    file.dispose()
    document.dispose()
  })
})

describe("A document's folder", () => {
  it('links the header back to the folder the document is in', async () => {
    const document = await openDocumentSession('brief')
    const scope = effectScope()
    const location = scope.run(() => useDriveDocumentLocation(document))

    expect(location?.value?.label).toBe('Projects')
    expect(location?.value?.to.path).toBe('/drive/f/p/projects')
    scope.stop()
    document.dispose()
  })
})
