import { beforeEach, describe, expect, it, vi } from 'vitest'

import FrappePushNotification from './frappe-push-notification'

// The relay's subscriptions, as the server keeps them for this token.
const relay = vi.hoisted(() => ({ subscribed: new Set<string>(), calls: [] as string[] }))
vi.mock('firebase/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase/messaging', () => ({
  deleteToken: vi.fn(),
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  isSupported: vi.fn(async () => true),
  onMessage: vi.fn(),
}))
vi.mock('@/api', () => ({
  api: { suite: { push: { subscribe: 'subscribe', unsubscribe: 'unsubscribe' } } },
  client: {
    async mutation(op: 'subscribe' | 'unsubscribe', { apps }: { apps: string[] }) {
      relay.calls.push(`${op} ${apps}`)
      for (const app of apps)
        if (op === 'subscribe') relay.subscribed.add(app)
        else relay.subscribed.delete(app)
      return { success: true }
    },
  },
}))

beforeEach(() => {
  localStorage.clear()
  relay.subscribed = new Set()
  relay.calls = []
})

describe("a device's push subscriptions, per app", () => {
  it('moves a token from before subscriptions were per app to the installed app it is in', async () => {
    // Turned on in Calendar's own app before subscriptions were per app: the relay knew it as Mail's.
    localStorage.setItem('firebase_token_mail', 'token-a')
    relay.subscribed = new Set(['mail'])

    await new FrappePushNotification('mail', 'https://relay.test', ['calendar']).syncApps()

    expect([...relay.subscribed]).toEqual(['calendar'])
  })

  it('keeps a browser tab, which is notified for every app, subscribed for Mail', async () => {
    localStorage.setItem('firebase_token_mail', 'token-a')
    relay.subscribed = new Set(['mail'])

    await new FrappePushNotification('mail', 'https://relay.test', ['mail', 'calendar']).syncApps()

    expect([...relay.subscribed].sort()).toEqual(['calendar', 'mail'])
    expect(relay.calls).toEqual(['subscribe calendar'])
  })

  it('adds an app installed since, and drops none it already recorded', async () => {
    localStorage.setItem('firebase_token_mail', 'token-a')
    localStorage.setItem('firebase_token_apps_mail', JSON.stringify(['mail']))
    relay.subscribed = new Set(['mail'])

    const client = new FrappePushNotification('mail', 'https://relay.test', ['calendar'])
    await client.syncApps()
    await client.syncApps()

    expect([...relay.subscribed].sort()).toEqual(['calendar', 'mail'])
    expect(relay.calls).toEqual(['subscribe calendar'])
  })
})
