import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, client } from '@/api'
import { useSession } from '@/platform/session'
import { TransportError, type Operation } from '@/platform/transport'
import { setTweaks } from '@/platform/tweaks'

import { settledDownload, type DriveDownload } from './downloads'

// The download poll's server: each poll takes the next answer, an Error is thrown.
const server = vi.hoisted(() => ({ polls: [] as unknown[], calls: 0 }))

vi.mock('@/platform/transport', async (original) => {
  const actual = await original<typeof import('@/platform/transport')>()
  return {
    ...actual,
    transport: {
      request: async (operation: Operation) => {
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
  server.calls = 0
  vi.useFakeTimers({ toFake: ['setTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
  setTweaks(['t31-poll-survives'], true)
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

  it('fails on the first dropped poll with the tweak off', async () => {
    setTweaks(['t31-poll-survives'], false)
    server.polls = [dropped(), ready]

    const settling = settledDownload(preparing)
    const failed = expect(settling).rejects.toMatchObject({ status: 0 })
    await vi.advanceTimersByTimeAsync(2000)

    await failed
  })
})
