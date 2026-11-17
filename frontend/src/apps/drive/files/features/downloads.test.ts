import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, client } from '@/api'
import { useSession } from '@/platform/session'
import { TransportError, type Operation } from '@/platform/transport'

import { downloadItems, settledDownload, type DriveDownload } from './downloads'

// The download poll's server: each poll takes the next answer, an Error is thrown.
const server = vi.hoisted(() => {
  const polls: unknown[] = []
  const signed: unknown[] = []
  return { polls, signed, calls: 0 }
})

vi.mock('@/platform/transport', async (original) => {
  const actual = await original<typeof import('@/platform/transport')>()
  return {
    ...actual,
    transport: {
      request: async (operation: Operation, input: { node?: string; download?: boolean }) => {
        if (operation.id === 'node_content_url') {
          server.signed.push(input)
          return { url: `https://bucket.storage.example/${input.node}?sig&save`, expires: 1 }
        }
        if (operation.id !== 'download_get') return {}
        server.calls += 1
        const answer = server.polls.shift()
        if (answer instanceof Error) throw answer
        return answer
      },
    },
  }
})

const preparing: DriveDownload = {
  name: 'download-1',
  title: 'Photos.zip',
  status: 'Preparing',
  delivery: 'Page',
  size: null,
  expires_at: null,
  error: null,
  url: null,
}
const ready: DriveDownload = { ...preparing, status: 'Ready', size: 10, url: '/zip' }
const dropped = () =>
  new TransportError({ type: 'NetworkError', message: 'Failed to fetch', status: 0 })

beforeAll(async () => {
  // Loads Drive's policy and validators under real timers, before the tests fake them.
  server.polls = [ready]
  await client.query(api.drive.downloads.get, { download: 'warm-up' })
})
beforeEach(() => {
  server.polls = []
  server.signed = []
  server.calls = 0
  vi.useFakeTimers({ toFake: ['setTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Waiting for a zip', () => {
  it('survives a dropped connection, says so, and settles when the zip is ready', async () => {
    server.polls = [dropped(), dropped(), ready]
    const connection: boolean[] = []

    const settling = settledDownload(preparing, { onConnection: (on) => connection.push(on) })
    await vi.advanceTimersByTimeAsync(2000 + 2000 + 4000)

    await expect(settling).resolves.toMatchObject({ status: 'Ready', url: '/zip' })
    expect(server.calls).toBe(3)
    expect(connection).toEqual([false, true])
  })

  it('fails at once when the download is gone', async () => {
    server.polls = [new TransportError({ type: 'DriveNotFound', message: 'Gone', status: 404 })]

    const settling = settledDownload(preparing)
    const failed = expect(settling).rejects.toMatchObject({ status: 404 })
    await vi.advanceTimersByTimeAsync(2000)

    await failed
    expect(server.calls).toBe(1)
  })

  it('stops waiting when the user signs out', async () => {
    server.polls = Array(10).fill(preparing)

    const settling = settledDownload(preparing)
    const stopped = expect(settling).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(2000)
    await useSession().logout()
    await vi.advanceTimersByTimeAsync(10_000)

    await stopped
    expect(server.calls).toBe(1)
  })
})

describe('Downloading one file', () => {
  let assign: ReturnType<typeof vi.fn>
  beforeEach(() => {
    assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('goes to the content route for a file the viewer holds in their own right', async () => {
    await downloadItems([{ name: 'n1', title: 'Plan.pdf', kind: 'file', access: { role: 10 } }])
    expect(assign).toHaveBeenCalledWith('/api/suite/drive/nodes/n1/content?download=1')
    expect(server.signed).toEqual([])
  })

  it('goes to a signed download URL for a file held through a share link', async () => {
    await downloadItems([
      { name: 'n2', title: 'Plan.pdf', kind: 'file', access: { role: 10, via_link: '$LINK:a' } },
    ])
    expect(server.signed).toEqual([{ node: 'n2', download: true }])
    expect(assign).toHaveBeenCalledWith('https://bucket.storage.example/n2?sig&save')
  })
})
