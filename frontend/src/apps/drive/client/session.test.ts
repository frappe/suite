import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTransport, TransportError, type Transport } from '@/platform/transport'

import { driveLinks } from './links'
import { ACCESS_REFRESH_MS, MEDIA_REFRESH_MS, openDriveDocumentSession } from './session'
import { testClient } from './testClient'

const documentNode = (name: string) => ({
  name,
  title: name,
  kind: 'document',
  parent_node: 'p',
  root: 'r',
  state: 'Active',
  trash_root: null,
  size: 0,
  mime: null,
  url: null,
  content_doctype: 'Presentation',
  content_docname: `doc-${name}`,
  is_template: 0,
  owner: { id: 'Administrator', full_name: 'Administrator', user_image: null },
  creation: null,
  modified: '2026-09-15',
  content_modified: null,
  access: { role: 40, via_link: null },
})
const code = (index: number) => `S${String(index).padStart(21, '0')}`

function transport(handler: (id: string, input: any) => any): Transport {
  return { request: (operation, input) => Promise.resolve(handler(operation.id, input)) }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('document session credentials', () => {
  it('groups references under the 20-code cap, each group with the document code', async () => {
    const requester = transport((id, input) => (id === 'node_get' ? documentNode(input.node) : {}))
    driveLinks.seed(code(0), 'deck')
    const ids = Array.from({ length: 21 }, (_, index) => `n${index}`)
    ids.forEach((id, index) => driveLinks.seed(code(index + 1), id))
    const session = await openDriveDocumentSession('deck', { client: testClient(requester) })

    const groups = session.credentials.group(ids)

    const sent: string[][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(new Headers(init?.headers).get('X-Drive-Links')!.split(','))
        return new Response('{}', { status: 200 })
      }),
    )
    for (const group of groups)
      await group.fetch('/api/method/suite.slides.api.composite.composite_group')

    expect(groups.map((group) => group.nodeIds)).toEqual([ids.slice(0, 19), ids.slice(19)])
    expect(sent.map((codes) => [codes[0], codes.length])).toEqual([
      [code(0), 20],
      [code(0), 3],
    ])
    session.dispose()
  })

  it('asks with every held code, the document code among them, for a manifest', async () => {
    const requester = transport((id, input) => (id === 'node_get' ? documentNode(input.node) : {}))
    driveLinks.seed(code(0), 'deck')
    driveLinks.seed(code(1), 'part-a')
    driveLinks.seed(code(2), 'part-b')
    const session = await openDriveDocumentSession('deck', { client: testClient(requester) })
    const sent: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(new Headers(init?.headers).get('X-Drive-Links')!)
        return new Response('{}', { status: 200 })
      }),
    )

    await session.credentials.fetchHeld('/api/method/suite.slides.api.composite.composite_manifest')

    expect(sent[0]!.split(',').sort()).toEqual([code(0), code(1), code(2)])
    session.dispose()
  })

  it('keeps the document link when a comment is missing, and forgets it when a product request answers 410', async () => {
    const sent: Array<string | null> = []
    const reply = (url: string) => {
      if (url.includes('/nodes/deck'))
        return new Response(JSON.stringify({ data: documentNode('deck') }))
      if (url.includes('/threads/')) {
        return new Response(
          JSON.stringify({ errors: [{ type: 'DriveNotFound', message: 'Missing' }] }),
          { status: 404 },
        )
      }
      return new Response(JSON.stringify({ exc_type: 'DriveLinkExpired' }), { status: 410 })
    }
    const record = async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get('X-Drive-Links'))
      return reply(String(url))
    }
    vi.stubGlobal('fetch', vi.fn(record))
    driveLinks.seed(code(0), 'deck')
    const session = await openDriveDocumentSession('deck', {
      client: testClient(createTransport({ fetch: record })),
    })

    await session.comments.reply('missing-thread', 'Hello').catch(() => null)
    await session.credentials.fetch('/api/method/suite.slides.api.composite.composite_manifest')
    await session.credentials.fetch('/api/method/suite.slides.api.composite.composite_manifest')

    expect(sent.slice(-3)).toEqual([code(0), code(0), null])
    session.dispose()
  })
})

describe('document session visits', () => {
  it("records a visit for the caller's own access, and none when a share link decides it", async () => {
    const visits: string[] = []
    const open = (viaLink: string | null) =>
      openDriveDocumentSession(viaLink ? 'linked' : 'own', {
        client: testClient(
          transport((id, input) => {
            if (id === 'node_visit') visits.push(input.node)
            return id === 'node_get'
              ? { ...documentNode(input.node), access: { role: 20, via_link: viaLink } }
              : {}
          }),
        ),
      })

    const own = await open(null)
    const linked = await open(`$LINK:${code(1)}`)

    expect(visits).toEqual(['own'])
    own.dispose()
    linked.dispose()
  })
})

describe('document session media', () => {
  it('refreshes signed media at ten minutes and keeps a signature-free cache key', async () => {
    vi.useFakeTimers()
    let mediaCalls = 0
    const requester = transport((id) => {
      if (id === 'node_get') return documentNode('root')
      if (id === 'node_media') {
        mediaCalls += 1
        return { media: [{ node: 'm1', url: `/f/blob?e=1&s=${mediaCalls}`, expires: 1 }] }
      }
      return {}
    })
    const session = await openDriveDocumentSession('root', { client: testClient(requester) })
    const handle = session.media('m1')
    await vi.runAllTicks()
    for (let i = 0; i < 15; i++) await Promise.resolve()
    expect(handle.cacheKey.value).toBe('drive-media:/f/blob')
    await vi.advanceTimersByTimeAsync(MEDIA_REFRESH_MS)
    expect(mediaCalls).toBeGreaterThanOrEqual(2)
    expect(handle.cacheKey.value).not.toContain('?')
    session.dispose()
  })
})

describe('document session access refresh', () => {
  const transportError = (type: string, status: number) =>
    new TransportError({ type, message: type, status })

  it('keeps access through network and server errors and refuses on a real answer', async () => {
    vi.useFakeTimers()
    let nextFailure: TransportError | null = null
    const requester: Transport = {
      request: (operation, input) =>
        operation.id === 'node_get' && nextFailure
          ? Promise.reject(nextFailure)
          : Promise.resolve(documentNode((input as { node: string }).node) as never),
    }
    const dependencies = {
      client: testClient(requester),
      signedIn: () => 'Administrator',
    }
    const session = await openDriveDocumentSession('root', dependencies)

    const passingFailures = [
      transportError('NetworkError', 0),
      transportError('ServerError', 500),
      transportError('Timeout', 408),
    ]
    for (const error of passingFailures) {
      nextFailure = error
      await vi.advanceTimersByTimeAsync(ACCESS_REFRESH_MS)
      expect(session.state.value).toBe('Active')
      expect(session.access.value.role).toBe(40)
    }

    nextFailure = transportError('DriveNotFound', 404)
    await vi.advanceTimersByTimeAsync(ACCESS_REFRESH_MS)
    expect(session.state.value).toBe('Refused')
    expect(session.access.value).toEqual({})
    session.dispose()
  })

  it('keeps access when signed out elsewhere, so the editor can say so', async () => {
    let nextFailure: TransportError | null = null
    let user: string | null = 'Administrator'
    let refusedCount = 0
    const fakeWindow = new EventTarget()
    const requester: Transport = {
      request: (operation, input) => {
        if (operation.id !== 'node_get' || !nextFailure) {
          return Promise.resolve(documentNode((input as { node: string }).node) as never)
        }

        refusedCount += 1
        return Promise.reject(nextFailure)
      },
    }
    const dependencies = {
      client: testClient(requester),
      window: fakeWindow as Window,
      signedIn: () => user,
    }
    const session = await openDriveDocumentSession('root', dependencies)
    user = null
    const refusals = [
      transportError('DriveNotFound', 404),
      transportError('SessionExpired', 401),
      transportError('PermissionError', 403),
    ]
    for (const error of refusals) {
      nextFailure = error
      const refusedBefore = refusedCount
      fakeWindow.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(refusedCount).toBe(refusedBefore + 1))
      await Promise.resolve()
      expect(session.state.value).toBe('Active')
      expect(session.access.value.role).toBe(40)
    }

    user = 'Administrator'
    fakeWindow.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(session.state.value).toBe('Refused'))
    session.dispose()
  })
})
