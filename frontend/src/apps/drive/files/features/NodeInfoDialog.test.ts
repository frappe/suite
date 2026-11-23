import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import { DOCUMENT_TYPES_KEY, type DocumentTypeDefinition } from '@/platform/contracts'
import type { Operation } from '@/platform/transport'

import NodeInfoDialog from './NodeInfoDialog.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const server = vi.hoisted(() => ({
  role: 50,
  /** The node's kind and document type: a PDF file unless a test sets a document. */
  kind: 'file',
  contentDoctype: fromPartial<string | null>(null),
  requests: fromPartial<string[]>([]),
  // An older Personal Root is titled with its owner's name.
  crumbs: [
    { name: 'root', title: 'Mira Shah', kind: 'root' },
    { name: 'reports', title: 'Reports', kind: 'folder' },
  ],
}))
const person = (id: string, full_name: string) => ({ id, full_name, user_image: null })
const grant = (principal: string, extra: Record<string, unknown> = {}) => ({
  node: 'report',
  principal,
  role: 10,
  expires_on: null,
  has_password: false,
  ...extra,
})

vi.mock('@/platform/transport', async (original) => ({
  ...(await original<typeof import('@/platform/transport')>()),
  transport: {
    request: async (operation: Operation, input: { node: string }) => {
      server.requests.push(operation.id)
      if (operation.id === 'roots_discover')
        return { personal: { node: 'root', title: 'Mira Shah' }, organization: null }
      if (operation.id === 'site_get') return { workspace_name: 'Northwind', workspace_logo: '' }
      if (operation.id === 'node_get')
        return {
          name: input.node,
          title: 'Report.pdf',
          kind: server.kind,
          content_doctype: server.contentDoctype,
          mime: 'application/pdf',
          size: 2048,
          state: 'Active',
          root: 'root',
          owner: person('me@example.com', 'Mira Shah'),
          breadcrumbs: server.crumbs,
          access: { role: server.role },
        }
      if (operation.id === 'node_grants')
        return {
          owner: person('me@example.com', 'Mira Shah'),
          grants: [
            grant('asha@example.com', { person: person('asha@example.com', 'Asha Rao') }),
            grant('$GROUP:Design'),
            // Denied here, so the folder's grant to Ravi gives nothing.
            grant('ravi@example.com', { role: 0, person: person('ravi@example.com', 'Ravi K') }),
            grant('old@example.com', {
              expires_on: '2020-01-01T00:00:00Z',
              person: person('old@example.com', 'Old Friend'),
            }),
            grant('$LINK', { name: 'link-1', url: '/l/abc' }),
          ],
          inherited: [
            {
              grant: grant('ravi@example.com', {
                node: 'folder',
                person: person('ravi@example.com', 'Ravi K'),
              }),
              redacted: false,
              source_node: 'folder',
              source_title: 'Reports',
            },
            {
              grant: grant('$GENERAL', { node: 'folder' }),
              redacted: false,
              source_node: 'folder',
              source_title: 'Reports',
            },
          ],
        }
      throw new Error(`Unexpected request ${operation.id}`)
    },
  },
}))

vi.mock('@/platform/session', async (original) => {
  const actual = await original<typeof import('@/platform/session')>()
  const { ref } = await import('vue')
  const status = ref('authenticated')
  return { ...actual, useSession: () => ({ ...actual.useSession(), status }) }
})

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  server.requests.length = 0
  server.role = 50
  server.kind = 'file'
  server.contentDoctype = null
})

const spreadsheets: DocumentTypeDefinition = {
  key: 'sheets',
  contentDoctype: 'Sheet',
  newLabel: () => 'Spreadsheet',
  icon: { render: () => null },
  loadSurface: async () => ({ render: () => null }),
}

function mount(node: string) {
  const root = document.createElement('div')
  const app = createApp({ render: () => h(NodeInfoDialog, { node, open: true }) })
  app.provide(DOCUMENT_TYPES_KEY, [spreadsheets])
  app.mount(root)
  unmount = () => app.unmount()
  return root
}

/** The value the dialog shows beside `label`. */
const field = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('dt')]
    .find((term) => term.textContent === label)
    ?.nextElementSibling?.textContent?.trim()

describe('Details', () => {
  it('tells someone who may share the item who else can open it', async () => {
    const root = mount('report')

    await vi.waitFor(() =>
      expect(field(root, 'Shared with')).toBe(
        'Asha Rao, Design, Everyone at Northwind, 1 share link',
      ),
    )
    expect(field(root, 'Owner')).toBe('Mira Shah')
  })

  it('names a document type as the New menu does', async () => {
    server.kind = 'document'
    server.contentDoctype = 'Sheet'
    const root = mount('budget')

    await vi.waitFor(() =>
      expect([...root.querySelectorAll('p')].map((line) => line.textContent)).toContain(
        'Spreadsheet',
      ),
    )
  })

  it('shows no sharing to someone who may not share it, and does not ask', async () => {
    server.role = 40
    const root = mount('notes')

    await vi.waitFor(() => expect(field(root, 'Owner')).toBe('Mira Shah'))
    expect(field(root, 'Shared with')).toBeUndefined()
    expect(server.requests).not.toContain('node_grants')
  })

  it('names the root in Location as the sidebar does', async () => {
    const root = mount('report')

    await vi.waitFor(() => expect(field(root, 'Location')).toBe('My files / Reports'))
  })
})
