import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { installEventReminders } from '@/apps/calendar'
import { createRealtime, type SocketLike } from '@/platform/realtime'
import { createSession } from '@/platform/session'
import type { Transport } from '@/platform/transport'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const shown = vi.hoisted(() =>
  fromPartial<
    {
      title: string
      options: { description?: string; action?: { label: string; onClick: () => void } }
    }[]
  >([]),
)

vi.mock('frappe-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('frappe-ui')>()),
  toast: {
    message: (title: string, options: (typeof shown)[number]['options']) =>
      shown.push({ title, options }),
  },
}))

/** The site's socket.io server, as the browser's one shell connection sees it. */
class ServerSocket implements SocketLike {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? new Set()).add(handler))
    return this
  }
  off(event: string, handler?: (...args: unknown[]) => void) {
    if (handler) this.handlers.get(event)?.delete(handler)
    return this
  }
  emit() {
    return this
  }
  publish(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload)
  }
}

const reminder = {
  title: 'Design review',
  body: 'In 10 minutes',
  path: '/calendar/event/ev-1',
}

/** A signed-in reader, with or without Calendar (the `jmap` capability). */
async function signIn(hasCalendar: boolean) {
  const account = { id: 'ann@example.com', capabilities: { jmap: hasCalendar } }
  const session = createSession(fromPartial<Transport>({ request: async () => account }))
  await session.login('ann@example.com', 'secret')
  return session
}

async function onHomePage() {
  const page = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home', component: page },
      { path: '/calendar/event/:id', component: page },
    ],
  })
  await router.push('/home')
  return router
}

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  shown.length = 0
})

describe('event reminders', () => {
  it('reach a reader on Home through the shell connection, and Open goes to the event', async () => {
    const server = new ServerSocket()
    const connect = vi.fn(() => server)
    const router = await onHomePage()
    stop = installEventReminders({
      open: (path) => void router.push(path),
      session: await signIn(true),
      connection: createRealtime({ io: connect, siteName: 'suite.test', window }),
    })

    server.publish('calendar_alert', reminder)

    expect(connect).toHaveBeenCalledOnce()
    expect(shown).toEqual([
      expect.objectContaining({
        title: 'Design review',
        options: expect.objectContaining({ description: 'In 10 minutes' }),
      }),
    ])
    shown[0]?.options.action?.onClick()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/calendar/event/ev-1'))
  })

  it('stay quiet for a reader without Calendar', async () => {
    const server = new ServerSocket()
    stop = installEventReminders({
      open: () => {},
      session: await signIn(false),
      connection: createRealtime({ io: () => server, siteName: 'suite.test', window }),
    })

    server.publish('calendar_alert', reminder)

    expect(shown).toEqual([])
  })
})
