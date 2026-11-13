import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useChangeSync } from '@/apps/mail/composables/useChangeSync'

const server = vi.hoisted<{
  syncs: number
  failing: boolean
  found: { new_mail_in: string[]; changed: boolean }
}>(() => ({
  syncs: 0,
  failing: false,
  found: { new_mail_in: [], changed: false },
}))

// The server's side: what a fetch of changes found, and how often it was asked.
vi.mock('@/api', () => ({
  api: { mail: { changes: { sync: 'mail.sync_changes' } } },
  client: {
    mutation: async () => {
      server.syncs += 1
      if (server.failing) throw new Error('Internal Server Error')
      return server.found
    },
  },
}))

type Listener = (...args: unknown[]) => void

const fakeSocket = () => {
  const manager: Record<string, Listener[]> = {}
  const events: Record<string, Listener[]> = {}
  return {
    connected: true,
    disconnected: false,
    connect: vi.fn(),
    io: {
      on: (event: string, fn: Listener) => (manager[event] ??= []).push(fn),
      off: () => {},
    },
    on: (event: string, fn: Listener) => (events[event] ??= []).push(fn),
    listeners: (event: string) => events[event] ?? [],
    reconnect: () => manager.reconnect?.forEach((fn) => fn()),
  }
}

let visibility: DocumentVisibilityState = 'visible'
let serverUnavailable = false
let scope = effectScope()

beforeEach(() => {
  scope = effectScope()
  vi.useFakeTimers()
  server.syncs = 0
  server.failing = false
  serverUnavailable = false
  server.found = { new_mail_in: [], changed: false }
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const start = () => {
  const socket = fakeSocket()
  scope.run(() => useChangeSync(fromPartial(socket), () => serverUnavailable))
  return socket
}

describe('useChangeSync keeps the lists up with the mail server', () => {
  it('asks when the app opens, then every 15 seconds while the page is looked at', async () => {
    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(server.syncs).toBe(1)

    await vi.advanceTimersByTimeAsync(45_000)

    expect(server.syncs).toBe(4)
  })

  it('asks nothing while the page is hidden, and asks at once when it is looked at again', async () => {
    visibility = 'hidden'
    start()
    await vi.advanceTimersByTimeAsync(45_000)
    expect(server.syncs).toBe(0)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(server.syncs).toBe(1)
  })

  it('asks when the socket comes back, and brings back a socket that gave up', async () => {
    const socket = start()
    await vi.advanceTimersByTimeAsync(0)
    server.syncs = 0

    socket.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(server.syncs).toBe(1)

    socket.disconnected = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.connect).toHaveBeenCalled()
  })

  it("hands what it found to the lists' own listeners while the socket is down", async () => {
    server.found = { new_mail_in: ['inbox'], changed: true }
    const socket = start()
    socket.connected = false
    const newMail = vi.fn()
    const changed = vi.fn()
    socket.on('new_mail_created', newMail)
    socket.on('mail_changed', changed)

    socket.reconnect()
    await vi.advanceTimersByTimeAsync(0)

    expect(newMail).toHaveBeenCalledWith(['inbox'])
    expect(changed).toHaveBeenCalled()
  })

  it('leaves it to the socket while the socket is up', async () => {
    server.found = { new_mail_in: ['inbox'], changed: true }
    const socket = start()
    const newMail = vi.fn()
    socket.on('new_mail_created', newMail)

    await vi.advanceTimersByTimeAsync(15_000)

    expect(newMail).not.toHaveBeenCalled()
  })

  it('asks less and less often while the server keeps failing, but keeps asking', async () => {
    server.failing = true
    start()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    const inFirstFiveMinutes = server.syncs

    // Looking again does not bring the next ask forward while they fail.
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    // Every 15 s would be 20 asks in each five minutes.
    expect(inFirstFiveMinutes).toBeLessThan(10)
    expect(server.syncs - inFirstFiveMinutes).toBeGreaterThan(0)
    expect(server.syncs - inFirstFiveMinutes).toBeLessThan(inFirstFiveMinutes)
  })

  it('goes back to every 15 seconds once the server answers again', async () => {
    server.failing = true
    start()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    server.failing = false
    const before = server.syncs
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(server.syncs).toBeGreaterThan(before)

    const answered = server.syncs
    await vi.advanceTimersByTimeAsync(45_000)

    expect(server.syncs - answered).toBe(3)
  })

  it('stops asking once the mail server is shown as unavailable', async () => {
    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(server.syncs).toBe(1)

    serverUnavailable = true
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(server.syncs).toBe(1)
  })
})
