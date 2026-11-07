import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import type { Operation } from '@/platform/transport'

import NodeInfoDialog from './NodeInfoDialog.vue'

const server = vi.hoisted(() => ({ role: 50, requests: [] as string[] }))
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
      if (operation.id === 'node_get')
        return {
          name: input.node,
          title: 'Report.pdf',
          kind: 'file',
          mime: 'application/pdf',
          size: 2048,
          state: 'Active',
          root: 'root',
          owner: person('me@example.com', 'Mira Shah'),
          breadcrumbs: [{ name: 'root', title: 'My files', kind: 'root' }],
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

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  server.requests.length = 0
  server.role = 50
})

function mount(node: string) {
  const root = document.createElement('div')
  const app = createApp({ render: () => h(NodeInfoDialog, { node, open: true }) })
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
        'Asha Rao, Design, Everyone in your organization, 1 share link',
      ),
    )
    expect(field(root, 'Owner')).toBe('Mira Shah')
  })

  it('shows no sharing to someone who may not share it, and does not ask', async () => {
    server.role = 40
    const root = mount('notes')

    await vi.waitFor(() => expect(field(root, 'Owner')).toBe('Mira Shah'))
    expect(field(root, 'Shared with')).toBeUndefined()
    expect(server.requests).not.toContain('node_grants')
  })
})
