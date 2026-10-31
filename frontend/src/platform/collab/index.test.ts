import type { CollabAdapter, CollabEndpoints } from '@suite/collab-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openCollabRoom } from './index'

const opened = vi.hoisted(() => ({ endpoints: null as CollabEndpoints | null }))

vi.mock('@suite/collab-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@suite/collab-client')>()),
  openDeviceStore: async () => null,
  openRoom: async (options: { endpoints: CollabEndpoints }) => {
    opened.endpoints = options.endpoints
    return { state: 'disabled' }
  },
}))

vi.mock('@/platform/realtime', () => ({ getRealtimeSocket: () => null }))

afterEach(() => {
  document.cookie = 'user_id=Guest; path=/'
})

async function endpointsFor(user: string) {
  const cookieUser = encodeURIComponent(user)
  document.cookie = `user_id=${cookieUser}; path=/`
  const calls: { url: string; method?: string; headers: Headers }[] = []
  async function fetch(url: string, init?: RequestInit) {
    calls.push({ url, method: init?.method, headers: new Headers(init?.headers) })
    return new Response(new Uint8Array())
  }

  const session = { nodeId: 'n1', credentials: { fetch }, title: { value: 'Notes' } }
  await openCollabRoom({ session, adapter: { app: 'writer' } as CollabAdapter })
  return { endpoints: opened.endpoints!, calls }
}

async function callEvery(endpoints: CollabEndpoints) {
  await endpoints.open()
  await endpoints.pull(5, 2)
  await endpoints.push(new Uint8Array([1]))
  await endpoints.stage('s1', 3, new Uint8Array([1]))
  await endpoints.session('a'.repeat(32))
  await endpoints.suspect(4)
  await endpoints.render('s1')
  await endpoints.beginRestore(7, 2)
  await endpoints.cancelRestore('t1')
}

describe('content endpoints', () => {
  it('reach the server content routes', async () => {
    const { endpoints, calls } = await endpointsFor('a@x.com')
    await callEvery(endpoints)

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/suite/content/n1/document',
      'GET /api/suite/content/n1/updates?since_rev=5&q_epoch=2',
      'POST /api/suite/content/n1/updates',
      'PUT /api/suite/content/n1/stage/s1/3',
      'POST /api/suite/content/n1/sessions',
      'POST /api/suite/content/n1/suspect',
      'POST /api/suite/content/n1/html',
      'POST /api/suite/content/n1/restore',
      'POST /api/suite/content/n1/restore/cancel',
    ])
  })

  it('name the signed-in user on every request', async () => {
    const { endpoints, calls } = await endpointsFor('a@x.com')
    await callEvery(endpoints)

    expect(calls.map(({ headers }) => headers.get('X-Expected-User'))).toEqual(
      Array(9).fill('a@x.com'),
    )
  })
})
