import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useChangeSync } from '@/apps/mail/composables/useChangeSync'

const server = vi.hoisted<{
  syncs: number
  failing: boolean
  // Never answers, as a request a phone left hanging when it put the app away.
  hanging: boolean
  found: { new_mail_in: string[]; changed: boolean; failed: boolean }
  // What happens on this side while the ask is out.
  meanwhile?: () => void
}>(() => ({
  syncs: 0,
  failing: false,
  hanging: false,
  found: { new_mail_in: [], changed: false, failed: false },
}))

// The server's side: what a fetch of changes found, and how often it was asked.
vi.mock('@/api', () => ({
  api: { mail: { changes: { sync: 'mail.sync_changes' } } },
  client: {
    mutation: async (_ref: unknown, _input: unknown, options?: { signal?: AbortSignal }) => {
      server.syncs += 1
      if (server.hanging)
        // Only its own abort ends it, as the transport's does.
        return new Promise((_, reject) =>
          options?.signal?.addEventListener('abort', () => reject(new Error('Aborted'))),
        )
      await Promise.resolve()
      server.meanwhile?.()
      if (server.failing) throw new Error('Internal Server Error')
      return server.found
    },
  },
}))

type Listener = (...args: unknown[]) => void

const fakeSocket = () => {
  const manager: Record<string, Listener[]> = {}
  const events: Record<string, Listener[]> = {}
  const socket = {
    connected: true,
    disconnected: false,
    // Still meant to be up: socket.io brings it back by itself whenever the manager reconnects.
    active: true,
    // Its CONNECT went out and waits for the server's answer.
    awaitingConnect: false,
    sentConnectTwice: false,
    connect: vi.fn(() => {
      if (socket.awaitingConnect) socket.sentConnectTwice = true
    }),
    io: {
      on: (event: string, fn: Listener) => (manager[event] ??= []).push(fn),
      off: () => {},
    },
    on: (event: string, fn: Listener) => (events[event] ??= []).push(fn),
    listeners: (event: string) => events[event] ?? [],
    reconnect: () => manager.reconnect?.forEach((fn) => fn()),
  }
  return socket
}

// This side closes the connection (a ping timeout after a laptop sleep). A second later the
// manager is back, says so, and the socket sends its CONNECT. A second CONNECT before the answer
// makes the server drop the connection, and it all starts again.
const dropFromThisSide = (socket: ReturnType<typeof fakeSocket>) => {
  socket.connected = false
  socket.disconnected = true
  setTimeout(() => {
    socket.awaitingConnect = true
    socket.reconnect()
    setTimeout(() => {
      socket.awaitingConnect = false
      if (socket.sentConnectTwice) {
        socket.sentConnectTwice = false
        return dropFromThisSide(socket)
      }
      socket.connected = true
      socket.disconnected = false
    }, 100)
  }, 1000)
}

let visibility: DocumentVisibilityState = 'visible'
let serverUnavailable = false
let scope = effectScope()

beforeEach(() => {
  scope = effectScope()
  vi.useFakeTimers()
  server.syncs = 0
  server.failing = false
  server.hanging = false
  serverUnavailable = false
  server.found = { new_mail_in: [], changed: false, failed: false }
  server.meanwhile = undefined
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

  it('asks when the socket comes back, and brings back a socket the server sent away', async () => {
    const socket = start()
    await vi.advanceTimersByTimeAsync(0)
    server.syncs = 0

    socket.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(server.syncs).toBe(1)

    socket.connected = false
    socket.disconnected = true
    socket.active = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.connect).toHaveBeenCalled()
  })

  it('asks once when a dropped socket comes back, and leaves its way back to it', async () => {
    const socket = start()
    await vi.advanceTimersByTimeAsync(0)
    server.syncs = 0

    dropFromThisSide(socket)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(server.syncs).toBe(1)
    expect(socket.connected).toBe(true)
  })

  it("hands what it found to the lists' own listeners while the socket is down", async () => {
    server.found = { new_mail_in: ['inbox'], changed: true, failed: false }
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

  it('hands it on too when the socket came up only while the ask was out', async () => {
    // The server may have announced it before this tab's socket joined.
    server.found = { new_mail_in: ['inbox'], changed: false, failed: false }
    const socket = start()
    await vi.advanceTimersByTimeAsync(0)
    socket.connected = false
    const newMail = vi.fn()
    socket.on('new_mail_created', newMail)
    server.meanwhile = () => (socket.connected = true)

    socket.reconnect()
    await vi.advanceTimersByTimeAsync(0)

    expect(newMail).toHaveBeenCalledWith(['inbox'])
  })

  it('leaves it to the socket while the socket is up', async () => {
    server.found = { new_mail_in: ['inbox'], changed: true, failed: false }
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

  it('asks less often while some account keeps failing, and hands on what the others found', async () => {
    server.found = { new_mail_in: ['inbox'], changed: false, failed: true }
    const socket = start()
    socket.connected = false
    const newMail = vi.fn()
    socket.on('new_mail_created', newMail)

    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(newMail).toHaveBeenCalledWith(['inbox'])
    // Every 15 s would be 20 asks in five minutes.
    expect(server.syncs).toBeLessThan(10)
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

  it('gives up an ask that never answers, and asks again', async () => {
    server.hanging = true
    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(server.syncs).toBe(1)

    await vi.advanceTimersByTimeAsync(2 * 60_000)

    expect(server.syncs).toBeGreaterThan(1)
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
