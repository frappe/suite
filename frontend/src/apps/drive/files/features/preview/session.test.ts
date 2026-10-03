import { describe, expect, it, vi } from 'vitest'

import type { Operation } from '@/platform/transport'

const server = vi.hoisted(() => ({
  viaLink: null as string | null,
  visits: [] as string[],
  starred: new Set<string>(),
  trashed: new Set<string>(),
}))

vi.mock('@/platform/transport', async (actual) => ({
  ...(await actual<typeof import('@/platform/transport')>()),
  transport: {
    request: async (operation: Operation, input: { node: string; nodes?: string[]; patch?: { state?: string } }) => {
      if (operation.id === 'node_visit') server.visits.push(input.node)
      if (operation.id === 'node_batch') {
        for (const node of input.nodes ?? []) {
          if (input.patch?.state === 'Trashed') server.trashed.add(node)
          else server.trashed.delete(node)
        }
        return { ok: input.nodes, failed: [] }
      }
      if (operation.id !== 'node_get') return {}
      const trashed = server.trashed.has(input.node)
      return {
        name: input.node, title: 'Plan.pdf', kind: 'file', parent_node: 'p', root: 'r',
        state: trashed ? 'Trashed' : 'Active', trash_root: trashed ? input.node : null, size: 1,
        mime: 'application/pdf', url: `/f/${input.node}`, content_doctype: null, content_docname: null,
        is_template: 0, owner: { id: 'asha@example.com', full_name: 'Asha', user_image: null }, creation: null, modified: null, content_modified: null,
        access: { role: 10, via_link: server.viaLink }, favourite: server.starred.has(input.node),
      }
    },
  },
}))

const { openFilePreviewSession } = await import('./session')
const { batchNodes } = await import('@/apps/drive/client/nodes')
const { useMutation } = await import('@/platform/server-state')

describe('file preview session', () => {
  it("records a visit for the caller's own access, and none when a share link decides it", async () => {
    const own = await openFilePreviewSession('own')
    server.viaLink = '$LINK:S000000000000000000001'
    const linked = await openFilePreviewSession('linked')

    expect(server.visits).toEqual(['own'])
    own.dispose()
    linked.dispose()
  })

  it("carries the caller's star and reads it again on refresh", async () => {
    server.viaLink = null
    server.starred.add('starred')
    const starred = await openFilePreviewSession('starred')
    const plain = await openFilePreviewSession('plain')
    expect(starred.favourite.value).toBe(true)
    expect(plain.favourite.value).toBe(false)

    server.starred.delete('starred')
    await starred.refreshPreview()
    expect(starred.favourite.value).toBe(false)
    starred.dispose()
    plain.dispose()
  })

  it('follows a restore and its undo made elsewhere, without waiting for a refresh', async () => {
    server.trashed.add('binned')
    const session = await openFilePreviewSession('binned')
    expect([session.state.value, session.trashRoot.value]).toEqual(['Trashed', 'binned'])

    const batch = useMutation(batchNodes())
    await batch.run({ nodes: ['binned'], patch: { state: 'Active' } })
    await vi.waitFor(() => expect([session.state.value, session.trashRoot.value]).toEqual(['Active', null]))

    await batch.run({ nodes: ['binned'], patch: { state: 'Trashed' } })
    await vi.waitFor(() => expect([session.state.value, session.trashRoot.value]).toEqual(['Trashed', 'binned']))
    session.dispose()
  })
})
