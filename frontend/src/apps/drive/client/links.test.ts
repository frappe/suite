import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Drive server double. Installed before any import, so the platform
// transport, and the link checks the store sends through it, use it too.
const net = vi.hoisted(() => {
  const state = {
    reply: (_path: string, _links: string | null): { status: number; body: unknown } => ({ status: 200, body: {} }),
    sent: [] as Array<{ path: string; links: string | null }>,
  }
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).split('?')[0]!
    const links = new Headers(init?.headers).get('X-Drive-Links')
    state.sent.push({ path, links })
    const { status, body } = state.reply(path, links)
    return new Response(JSON.stringify(body), { status })
  }
  return state
})

import { createLinkStore, driveLinks, LINK_CAP } from './links'
import { batchNodes, children, moveNode, node } from './nodes'
import { createSession } from '@/platform/session'
import { transport, type Transport } from '@/platform/transport'

// Share-link tokens are 22 base62 characters (Drive spec §4.7).
const code = (index: number) => `L${String(index).padStart(21, '0')}`
const MAC = 'a'.repeat(64)

type Reply = { status: number; body: unknown }
const ok = (data: unknown): Reply => ({ status: 200, body: { data } })
const refused = (status: number, type: string): Reply => ({ status, body: { errors: [{ type, message: type }] } })
const row = (name: string) => ({
  name, title: name, kind: 'folder', parent_node: 'p', root: 'r', state: 'Active', trash_root: null, size: 0, mime: null, url: null,
  content_doctype: null, content_docname: null, is_template: 0, owner: { id: 'owner@example.com', full_name: 'Owner', user_image: null },
  creation: null, modified: null, content_modified: null,
})
const nodeIn = (path: string) => path.split('/')[5] ?? ''

/** Sets how the server answers. It records the X-Drive-Links header of every request. */
function server(reply: (path: string, links: string | null) => Reply = (path) => ok(row(nodeIn(path)))) {
  net.reply = reply
  net.sent = []
  return { transport, sent: net.sent }
}

const read = (client: Transport, id: string) => client.request(node(id).operation, { node: id }).catch(() => null)
/** Lets the link checks a failed request started finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const lastLinks = (sent: Array<{ links: string | null }>) => sent.at(-1)?.links ?? null

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('Drive link codes on requests', () => {
  it('sends a code for the link target and the nodes read through it, and none elsewhere', async () => {
    const { transport, sent } = server((path) =>
      path.endsWith('/children') ? ok({ rows: [row('child-a'), row('child-b')], next_cursor: null }) : ok(row(nodeIn(path))),
    )
    driveLinks.seed(code(1), 'shared-folder')

    await transport.request(children({ node: 'shared-folder' }).operation, { node: 'shared-folder' })
    await read(transport, 'child-b')
    await read(transport, 'my-own-file')

    expect(sent.map((request) => request.links)).toEqual([code(1), code(1), null])
  })

  it('refuses a write that needs more than 20 codes, and sends nothing', async () => {
    const { transport, sent } = server(() => ok({ ok: [], failed: [] }))
    const nodes = Array.from({ length: LINK_CAP + 1 }, (_, index) => `n${index}`)
    nodes.forEach((id, index) => driveLinks.seed(code(index), id))

    await expect(
      transport.request(batchNodes().operation, { nodes, patch: { state: 'Trashed' } }),
    ).rejects.toMatchObject({
      message: 'These items come from more than 20 share links. Select fewer and try again.',
    })
    expect(sent).toHaveLength(0)

    await transport.request(batchNodes().operation, { nodes: nodes.slice(1), patch: { state: 'Trashed' } })
    expect(sent).toHaveLength(1)
  })

  it('counts the destination folder of a move', async () => {
    const { transport, sent } = server()
    driveLinks.seed(code(1), 'item')
    driveLinks.seed(code(2), 'destination')

    await transport.request(moveNode().operation, { node: 'item', parent_node: 'destination' })

    expect(lastLinks(sent)?.split(',').sort()).toEqual([code(1), code(2)])
  })

  it('sends the newest link for a target when the same item was shared again', async () => {
    const { transport, sent } = server()
    driveLinks.seed(code(1), 'folder')
    await read(transport, 'folder')
    driveLinks.seed(code(2), 'folder')
    await read(transport, 'folder')
    driveLinks.seed(code(3), 'other')
    driveLinks.seed(code(4), 'other')
    await read(transport, 'other')

    expect(sent.map((request) => request.links)).toEqual([code(1), code(2), code(4)])
  })

  it('splits a read over 20 codes into ordered groups that each fit one request', () => {
    const ids = Array.from({ length: 45 }, (_, index) => `n${index}`)
    ids.forEach((id, index) => driveLinks.seed(code(index), id))
    driveLinks.seed(code(99), 'document')

    const groups = driveLinks.group([...ids, 'untagged'], ['document'])

    expect(groups.map((group) => group.nodeIds.length)).toEqual([19, 19, 8])
    expect(groups.flatMap((group) => group.nodeIds)).toEqual([...ids, 'untagged'])
    for (const group of groups) {
      const links = group.scope.headers!['X-Drive-Links']!.split(',')
      expect(links).toContain(code(99))
      expect(links.length).toBeLessThanOrEqual(20)
    }
  })
})

describe('every held code on one request', () => {
  it('sends the document code and the most recently used others, at most 20', () => {
    driveLinks.seed(code(99), 'document')
    const ids = Array.from({ length: 25 }, (_, index) => `n${index}`)
    ids.forEach((id, index) => driveLinks.seed(code(index), id))

    const links = driveLinks.scopeHeld(['document']).headers!['X-Drive-Links']!.split(',')

    expect(links).toHaveLength(LINK_CAP)
    expect(links).toContain(code(99))
    expect(links.filter((sent) => sent !== code(99)).sort()).toEqual(
      ids.slice(6).map((_, index) => code(index + 6)).sort(),
    )
  })

  it('keeps which links were used least recently, so eviction still drops those', () => {
    driveLinks.seed(code(1), 'old')
    driveLinks.seed(code(2), 'new')
    driveLinks.scopeHeld([])
    const nodes = Array.from({ length: 49 }, (_, index) => `x${index}`)
    nodes.forEach((id, index) => driveLinks.seed(code(100 + index), id))

    // 51 links: the least recently used one goes.
    expect(driveLinks.scope(['old']).headers).toEqual({})
    expect(driveLinks.scope(['new']).headers).toEqual({ 'X-Drive-Links': code(2) })
  })
})

describe('forgetting Drive link codes', () => {
  it('drops a link and its tags when its target answers 404, or any node answers 410', async () => {
    let target = ok({ rows: [row('inside')], next_cursor: null })
    const { transport, sent } = server((path) => (path.endsWith('/children') ? target : refused(404, 'DriveNotFound')))
    driveLinks.seed(code(1), 'gone')
    driveLinks.seed(code(2), 'expired')
    await transport.request(children({ node: 'expired' }).operation, { node: 'expired' })

    await read(transport, 'gone')
    await read(transport, 'gone')

    target = refused(410, 'DriveLinkExpired')
    await transport.request(children({ node: 'expired' }).operation, { node: 'expired' }).catch(() => null)
    await read(transport, 'inside')

    expect(sent.map((request) => request.links)).toEqual([code(2), code(1), null, code(2), null])
  })

  it('keeps a link when a request that names its target fails on another resource', async () => {
    const { transport, sent } = server((path) => (path.endsWith('/shared') ? ok(row('shared')) : refused(404, 'DriveNotFound')))
    driveLinks.seed(code(1), 'shared')

    await transport.request(moveNode().operation, { node: 'shared', parent_node: 'missing' }).catch(() => null)
    await transport.request(children({ node: 'shared' }).operation, { node: 'shared' }).catch(() => null)
    await read(transport, 'shared')

    expect(sent.map((request) => request.links)).toEqual([code(1), code(1), code(1)])
  })

  it('checks each link again after a 410 on a request with several, and drops only the expired one', async () => {
    const { transport, sent } = server((path, links) => {
      if (path.endsWith('/batch') || links === code(1)) return refused(410, 'DriveLinkExpired')
      return ok(row(nodeIn(path)))
    })
    driveLinks.seed(code(1), 'expired-item')
    driveLinks.seed(code(2), 'live-item')

    const nodes = ['expired-item', 'live-item']
    await transport.request(batchNodes().operation, { nodes, patch: { state: 'Trashed' } }).catch(() => null)
    await settle()
    const checks = sent.slice(1).map((request) => [request.path.split('/').at(-1), request.links])
    await read(transport, 'expired-item')
    await read(transport, 'live-item')

    expect(checks.sort()).toEqual([['expired-item', code(1)], ['live-item', code(2)]])
    expect(sent.slice(-2).map((request) => request.links)).toEqual([null, code(2)])
  })

  it('keeps a link when a node inside its folder answers 404', async () => {
    const { transport, sent } = server((path) =>
      path.endsWith('/children')
        ? ok({ rows: [row('deleted-child')], next_cursor: null })
        : path.includes('deleted-child') ? refused(404, 'DriveNotFound') : ok(row(nodeIn(path))),
    )
    driveLinks.seed(code(1), 'folder')
    await transport.request(children({ node: 'folder' }).operation, { node: 'folder' })

    await read(transport, 'deleted-child')
    await read(transport, 'folder')

    expect(lastLinks(sent)).toBe(code(1))
  })

  it('drops an expired or refused unlock ticket and keeps the bare code', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T00:00:00Z'))
    const now = Math.floor(Date.now() / 1000)
    let locked = false
    const { transport, sent } = server((path) => (locked ? refused(401, 'DriveLocked') : ok(row(nodeIn(path)))))
    driveLinks.seed(code(1), 'expiring')
    driveLinks.unlock(code(1), `${now + 60}.${MAC}`)
    driveLinks.seed(code(2), 'rotated')
    driveLinks.unlock(code(2), `${now + 3600}.${MAC}`)

    await read(transport, 'expiring')
    vi.setSystemTime(Date.now() + 61_000)
    await read(transport, 'expiring')

    locked = true
    await read(transport, 'rotated')
    locked = false
    await read(transport, 'rotated')

    expect(sent.map((request) => request.links)).toEqual([
      `${code(1)}.${now + 60}.${MAC}`,
      code(1),
      `${code(2)}.${now + 3600}.${MAC}`,
      code(2),
    ])
  })

  it('forgets the least recently used link past 50 links, and the oldest tag past 1000 tags', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => row(`row${index}`))
    const { transport, sent } = server((path) =>
      path.endsWith('/children') ? ok({ rows, next_cursor: null }) : ok(row(nodeIn(path))),
    )
    for (let index = 0; index < 50; index += 1) driveLinks.seed(code(index), `target${index}`)
    await read(transport, 'target0')
    driveLinks.seed(code(50), 'target50')

    await read(transport, 'target0')
    await read(transport, 'target1')
    await transport.request(children({ node: 'target0' }).operation, { node: 'target0' })
    await read(transport, 'row0')
    await read(transport, 'row1000')

    expect(sent.slice(1).map((request) => request.links)).toEqual([code(0), null, code(0), null, code(0)])
  })

  it('keeps links through sign-in, ignores the guest name while signed in, and clears all on sign out', async () => {
    const { transport, sent } = server()
    const session = createSession({ request: async () => ({}) } as unknown as Transport)
    const links = createLinkStore({ storage: localStorage, session })
    links.seed(code(1), 'shared')
    links.setGuestName('Ravi (Acme)')
    const asGuest = links.guestName()

    await session.login('ravi@example.com', 'secret')
    const signedIn = links.guestName()
    await read(transport, 'shared')
    await session.logout()
    await read(transport, 'shared')

    expect([asGuest, signedIn]).toEqual(['Ravi (Acme)', null])
    expect(sent.map((request) => request.links)).toEqual([code(1), null])
    expect(localStorage.length).toBe(0)
  })
})

describe('the stored copy', () => {
  const session = () => createSession({ request: async () => ({}) } as unknown as Transport)
  const headerFor = (links: ReturnType<typeof createLinkStore>, id: string) =>
    links.scope([id]).headers?.['X-Drive-Links'] ?? null

  it('lets a sign-out in another tab end this tab\'s links, and a late response write nothing back', () => {
    const shared = memoryStorage()
    // This tab could not store its link, so only its working copy holds it.
    const full = { ...shared, getItem: shared.getItem, removeItem: shared.removeItem, setItem: refuseWrite }
    const events = new EventTarget()
    const tab = createLinkStore({ storage: full, session: session(), events })
    const otherTab = createLinkStore({ storage: shared, session: session(), events: new EventTarget() })
    tab.seed(code(1), 'folder')
    const pending = tab.scope(['folder'], { returnsNodes: true })

    otherTab.clear()
    events.dispatchEvent(Object.assign(new Event('storage'), { key: 'suite:drive-links', newValue: null }))
    pending.settled?.({ ok: true, output: { rows: [row('child')], next_cursor: null } })

    expect([headerFor(tab, 'folder'), headerFor(tab, 'child')]).toEqual([null, null])
    expect(shared.getItem('suite:drive-links')).toBeNull()
  })

  it('ignores a response from before sign out, even when the same link is opened again', async () => {
    const auth = session()
    const links = createLinkStore({ storage: memoryStorage(), session: auth, events: new EventTarget() })
    links.seed(code(1), 'folder')
    const pending = links.scope(['folder'], { returnsNodes: true })

    await auth.logout()
    links.seed(code(1), 'folder')
    pending.settled?.({ ok: true, output: { rows: [row('child')], next_cursor: null } })

    expect([headerFor(links, 'folder'), headerFor(links, 'child')]).toEqual([code(1), null])
  })

  it('reads links another tab stored', () => {
    const shared = memoryStorage()
    const tab = createLinkStore({ storage: shared, session: session(), events: new EventTarget() })
    const otherTab = createLinkStore({ storage: shared, session: session(), events: new EventTarget() })
    expect(headerFor(tab, 'folder')).toBeNull()

    otherTab.seed(code(1), 'folder')

    expect(headerFor(tab, 'folder')).toBe(code(1))
  })

  it('drops malformed stored entries and keeps the valid ones', () => {
    const storage = memoryStorage()
    storage.setItem('suite:drive-links', JSON.stringify({
      links: {
        [code(1)]: { target: 'good', lastUsed: 1 },
        [code(2)]: { target: 'bad-ticket', ticket: 5, lastUsed: 1 },
        [code(3)]: { target: 'bad-time', lastUsed: 'yesterday' },
        [code(4)]: { target: 7, lastUsed: 1 },
        [code(5)]: null,
        'not-a-token': { target: 'bad-code', lastUsed: 1 },
      },
      tags: [['child', code(1)], ['orphan', code(9)], ['short'], [1, 2], 'x'],
    }))
    const links = createLinkStore({ storage, session: session(), events: new EventTarget() })

    const sent = ['good', 'child', 'bad-ticket', 'bad-time', 'orphan', 'bad-code'].map((id) => headerFor(links, id))

    expect(sent).toEqual([code(1), code(1), null, null, null, null])
  })

  it('keeps working in memory when storage refuses to write', () => {
    const storage = memoryStorage()
    storage.setItem = refuseWrite
    const links = createLinkStore({ storage, session: session(), events: new EventTarget() })

    links.seed(code(1), 'folder')
    links.scope(['folder'], { returnsNodes: true }).settled?.({ ok: true, output: row('folder') })

    expect(headerFor(links, 'folder')).toBe(code(1))
  })
})

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, String(value)),
    removeItem: (key) => void values.delete(key),
  }
}

function refuseWrite(): never {
  throw new DOMException('Full', 'QuotaExceededError')
}
