import { describe, expect, it, vi } from 'vitest'

import type { Operation } from '@/platform/transport'

const server = vi.hoisted(() => ({ viaLink: null as string | null, visits: [] as string[], starred: new Set<string>() }))

vi.mock('@/platform/transport', async (actual) => ({
  ...(await actual<typeof import('@/platform/transport')>()),
  transport: {
    request: async (operation: Operation, input: { node: string }) => {
      if (operation.id === 'node_visit') server.visits.push(input.node)
      if (operation.id !== 'node_get') return {}
      return {
        name: input.node, title: 'Plan.pdf', kind: 'file', parent: 'p', root: 'r', state: 'Active', size: 1,
        mime: 'application/pdf', url: `/f/${input.node}`, content_doctype: null, content_docname: null,
        is_template: 0, owner: 'asha@example.com', creation: null, modified: null, content_modified: null,
        access: { role: 10, via_link: server.viaLink }, favourite: server.starred.has(input.node),
      }
    },
  },
}))

const { openFilePreviewSession } = await import('./session')

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
})
