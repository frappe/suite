import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { Operation } from '@/platform/transport'

// A Drive server with one PDF and some Writer documents, which records each request.
// `role` is the caller's role on the node; `folder` their role on its folder,
// or null when they cannot see the folder.
const server = vi.hoisted(() => ({
  requests: [] as string[],
  documents: {
    brief: { role: 10, folder: 10 },
    mine: { role: 50, folder: 50 },
    'in-viewed-folder': { role: 40, folder: 10 },
    'shared-alone': { role: 10, folder: null },
  } as Record<string, { role: number; folder: number | null }>,
}))

vi.mock('@/platform/transport', async (actual) => ({
  ...(await actual<typeof import('@/platform/transport')>()),
  transport: {
    request: async (operation: Operation, input: { node: string }) => {
      server.requests.push(`${operation.id} ${input.node}`)
      if (operation.id !== 'node_get') return {}
      const document = server.documents[input.node]
      const folder = document ? document.folder : 10
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
        access: { role: document?.role ?? 10, via_link: null },
        breadcrumbs:
          folder === null ? [] : [{ name: 'p', title: 'Projects', kind: 'folder', role: folder }],
      }
    },
  },
}))

const { openDocumentSession, useDriveDocumentActions } = await import('./index')

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

describe("A document's Drive menu", () => {
  async function nodeActionLabels(node: string): Promise<string[]> {
    const session = await openDocumentSession(node)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:path(.*)*', component: { render: () => null } }],
    })
    let labels: string[] = []
    const app = createApp(
      defineComponent({
        setup() {
          labels = useDriveDocumentActions(session).value.node.map((action) => action.label)
          return () => null
        },
      }),
    )
    app.use(router).mount(document.createElement('div'))
    app.unmount()
    session.dispose()
    return labels
  }

  it('offers Duplicate to the owner of the document and its folder', async () => {
    expect(await nodeActionLabels('mine')).toContain('Duplicate')
  })

  it('hides Duplicate from a caller who only views the folder, even with edit on the document', async () => {
    expect(await nodeActionLabels('in-viewed-folder')).not.toContain('Duplicate')
  })

  it('hides Duplicate from a caller who can see the document but not its folder', async () => {
    expect(await nodeActionLabels('shared-alone')).not.toContain('Duplicate')
  })
})
