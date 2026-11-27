import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase/messaging/sw', () => ({ getMessaging: vi.fn() }))

// The worker's global scope: its listeners, and the notifications it shows.
const worker = vi.hoisted(() => {
  const shown: Array<[string, NotificationOptions]> = []
  return { listeners: new Map<string, (event: unknown) => void>(), shown }
})

beforeEach(async () => {
  vi.resetModules()
  worker.listeners.clear()
  worker.shown = []
  vi.stubGlobal('self', {
    location: new URL('https://suite.test/assets/suite/frontend/sw.js'),
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      worker.listeners.set(type, listener),
    registration: {
      showNotification: async (title: string, options: NotificationOptions) => {
        worker.shown.push([title, options])
      },
    },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await import('./sw')
})

/** A push event carrying `message` as its JSON, recording what the worker does with it. */
function push(message: unknown) {
  const waitedFor: Promise<unknown>[] = []
  const event = {
    data: { json: () => message },
    waitedFor,
    waitUntil(promise: Promise<unknown>) {
      this.waitedFor.push(promise)
    },
    stopped: false,
    stopImmediatePropagation() {
      this.stopped = true
    },
  }
  worker.listeners.get('push')!(event)
  return event
}

describe('a push reaching Mail’s worker', () => {
  it('shows a Suite push itself and keeps the push event open until it is shown', async () => {
    const event = push({
      data: { title: 'Ana', body: 'Lunch?', click_action: 'https://suite.test/mail/x' },
      fcmMessageId: 'm-1',
    })

    expect(event.waitedFor).toHaveLength(1)
    await Promise.all(event.waitedFor)
    expect(worker.shown).toEqual([['Ana', expect.objectContaining({ body: 'Lunch?', tag: 'm-1' })]])
    // Firebase, which would hand it to a visible page and show nothing, never sees it.
    expect(event.stopped).toBe(true)
  })

  it('leaves a push that is not a Suite push to Firebase', () => {
    const event = push({ notification: { title: 'From the console' } })

    expect(event.stopped).toBe(false)
    expect(event.waitedFor).toEqual([])
  })
})
