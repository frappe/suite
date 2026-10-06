import { describe, expect, it, vi } from 'vitest'

import type { DriveBreadcrumb } from '@/apps/drive/client/types'
import type { Operation } from '@/platform/transport'

const server = vi.hoisted(() => ({
  viaLink: null as string | null,
  visits: [] as string[],
  starred: new Set<string>(),
  trashed: new Set<string>(),
  /** The breadcrumbs a node read answers with, root first, down to the parent. */
  trails: new Map<string, DriveBreadcrumb[]>(),
}))

vi.mock('@/platform/transport', async (actual) => ({
  ...(await actual<typeof import('@/platform/transport')>()),
  transport: {
    request: async (
      operation: Operation,
      input: { node: string; nodes?: string[]; patch?: { state?: string } },
    ) => {
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
      const breadcrumbs = server.trails.get(input.node)
      return {
        name: input.node,
        title: 'Plan.pdf',
        kind: 'file',
        parent_node: breadcrumbs?.at(-1)?.name ?? 'p',
        breadcrumbs,
        root: 'r',
        state: trashed ? 'Trashed' : 'Active',
        trash_root: trashed ? input.node : null,
        size: 1,
        mime: 'application/pdf',
        url: `/f/${input.node}`,
        content_doctype: null,
        content_docname: null,
        is_template: 0,
        owner: { id: 'asha@example.com', full_name: 'Asha', user_image: null },
        creation: null,
        modified: null,
        content_modified: null,
        access: { role: 10, via_link: server.viaLink },
        favourite: server.starred.has(input.node),
      }
    },
  },
}))

const { openFilePreviewSession } = await import('./session')
const { api, useMutation } = await import('@/api')

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

  it('names the folder a file is in, and no folder for a picture inside a document', async () => {
    const root = { name: 'r', title: 'My files', kind: 'root' }
    const folder = { name: 'talks', title: 'Talks', kind: 'folder' }
    const deck = { name: 'deck', title: 'Launch', kind: 'document' }
    server.trails.set('in-folder', [root, folder])
    server.trails.set('in-root', [root])
    // A document is never listed as a folder, so a picture under it has none to step through.
    server.trails.set('in-deck', [root, folder, deck])
    server.trails.set('below-deck', [
      root,
      deck,
      { name: 'assets', title: 'Assets', kind: 'folder' },
    ])

    const sessions = await Promise.all(
      ['in-folder', 'in-root', 'in-deck', 'below-deck'].map((node) => openFilePreviewSession(node)),
    )
    expect(sessions.map((session) => session.folder.value?.name ?? null)).toEqual([
      'talks',
      'r',
      null,
      null,
    ])
    for (const session of sessions) session.dispose()
  })

  it('follows a restore and its undo made elsewhere, without waiting for a refresh', async () => {
    server.trashed.add('binned')
    const session = await openFilePreviewSession('binned')
    expect([session.state.value, session.trashRoot.value]).toEqual(['Trashed', 'binned'])

    const batch = useMutation(api.drive.nodes.batch)
    await batch.run({ nodes: ['binned'], patch: { state: 'Active' } })
    await vi.waitFor(() =>
      expect([session.state.value, session.trashRoot.value]).toEqual(['Active', null]),
    )

    await batch.run({ nodes: ['binned'], patch: { state: 'Trashed' } })
    await vi.waitFor(() =>
      expect([session.state.value, session.trashRoot.value]).toEqual(['Trashed', 'binned']),
    )
    session.dispose()
  })
})
