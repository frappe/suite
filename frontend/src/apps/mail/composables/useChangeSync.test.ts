import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useChangeSync } from '@/apps/mail/composables/useChangeSync'

const server = vi.hoisted(() => ({
  syncs: 0,
  found: { new_mail_in: [] as string[], changed: false },
}))

// The server's side: what a fetch of changes found, and how often it was asked.
vi.mock('@/api', () => ({
  api: { mail: { changes: { sync: 'mail.sync_changes' } } },
  client: {
    mutation: async () => {
      server.syncs += 1
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
let scope = effectScope()

beforeEach(() => {
  scope = effectScope()
  vi.useFakeTimers()
  server.syncs = 0
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
  scope.run(() => useChangeSync(socket as never))
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
})
