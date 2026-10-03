import { describe, expect, it } from 'vitest'

import { createLinkStore } from './links'
import { isDriveLocked, unlockNode } from './unlock'
import { createSession } from '@/platform/session'
import { TransportError, createTransport, type Transport } from '@/platform/transport'

const CODE = 'L000000000000000000001'
const TICKET = `${Math.floor(Date.now() / 1000) + 3600}.${'b'.repeat(64)}`

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

/** A Drive server double that answers the unlock route, and records what it was sent. */
function unlockServer(answer: (password: string) => { status: number; body: unknown; headers?: HeadersInit }) {
  const sent: Array<{ url: string; body: unknown }> = []
  const transport = createTransport({
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { password: string }
      sent.push({ url: String(url), body })
      const reply = answer(body.password)
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: reply.headers })
    },
  })
  return { transport, sent }
}

function heldLink() {
  const links = createLinkStore({
    storage: memoryStorage(),
    session: createSession({ request: async () => ({}) } as unknown as Transport),
  })
  links.seed(CODE, 'locked-folder')
  return links
}

describe('unlocking a password link', () => {
  it('trades the right password for a ticket that the next request for the node carries', async () => {
    const links = heldLink()
    const { transport, sent } = unlockServer((password) =>
      password === 'open sesame'
        ? { status: 200, body: { data: { ticket: TICKET, expires: 0 } } }
        : { status: 401, body: { errors: [{ type: 'DriveLocked', message: 'The Drive link password is incorrect' }] } },
    )

    const wrong = await unlockNode('locked-folder', 'guess', { transport, links })
    const right = await unlockNode('locked-folder', 'open sesame', { transport, links })

    expect([wrong, right]).toEqual([{ status: 'wrong-password' }, { status: 'unlocked' }])
    expect(sent[0]).toEqual({ url: '/api/suite/drive/links/unlock', body: { token: CODE, password: 'guess' } })
    expect(links.scope(['locked-folder']).headers).toEqual({ 'X-Drive-Links': `${CODE}.${TICKET}` })
  })

  it('reports a lockout with the wait the server names', async () => {
    const { transport } = unlockServer(() => ({
      status: 429,
      body: { errors: [{ type: 'RateLimitExceededError', message: 'Too many attempts' }] },
      headers: { 'Retry-After': '872' },
    }))

    await expect(unlockNode('locked-folder', 'guess', { transport, links: heldLink() })).resolves.toEqual({
      status: 'locked-out',
      retryAfterMs: 872_000,
    })
  })

  it('sends nothing when this browser holds no link for the node', async () => {
    const { transport, sent } = unlockServer(() => ({ status: 200, body: { data: {} } }))

    const outcome = await unlockNode('some-other-node', 'guess', { transport, links: heldLink() })

    expect(outcome.status).toBe('failed')
    expect(sent).toHaveLength(0)
  })

  it('reads a locked node from a thrown error and from a query\'s stored error alike', () => {
    const locked = { type: 'DriveLocked', message: 'Locked', status: 401 }
    expect([
      isDriveLocked(new TransportError(locked)),
      isDriveLocked({ ...locked }),
      isDriveLocked({ ...locked, type: 'DriveNotFound' }),
      isDriveLocked({ ...locked, status: 403 }),
      isDriveLocked(null),
    ]).toEqual([true, true, false, false, false])
  })
})
