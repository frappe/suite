import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FrappePushNotification from './frappe-push-notification'

// The relay's subscriptions, as the server keeps them for this token.
const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const relay = vi.hoisted(() => ({
  subscribed: new Set<string>(),
  calls: fromPartial<string[]>([]),
}))
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

// Firebase's getMessaging rejects, uncaught, where the browser lacks the APIs it needs.
it('starts no messaging in a browser Firebase does not support, such as iPhone Safari', async () => {
  vi.mocked(isSupported).mockResolvedValueOnce(false)
  const push = new FrappePushNotification('mail', 'https://relay.test')

  await push.initialize(fromPartial<ServiceWorkerRegistration>({}))

  expect(getMessaging).not.toHaveBeenCalled()
  expect(push.messaging).toBeNull()
})

describe('a device already notified, as the app starts', () => {
  async function startedDevice(token: string) {
    localStorage.setItem('firebase_token_mail', token)
    localStorage.setItem('firebase_token_apps_mail', '["mail"]')
    relay.subscribed = new Set(['mail'])
    vi.stubGlobal('Notification', { permission: 'granted' })
    vi.stubGlobal('fetch', async () => ({ json: async () => ({ vapid_public_key: 'vapid' }) }))
    const push = new FrappePushNotification('mail', 'https://relay.test')
    await push.initialize(fromPartial<ServiceWorkerRegistration>({}))
    push.messaging = fromPartial({})
    return push
  }

  it('moves the relay to the new token Firebase gives when the browser dropped the old subscription', async () => {
    const push = await startedDevice('token-dropped')
    vi.mocked(getToken).mockResolvedValueOnce('token-renewed')

    await push.refreshToken()

    expect(relay.calls).toEqual(['unsubscribe mail', 'subscribe mail'])
    expect(localStorage.getItem('firebase_token_mail')).toBe('token-renewed')
  })

  it('tells the relay nothing while the token still holds', async () => {
    const push = await startedDevice('token-live')
    vi.mocked(getToken).mockResolvedValueOnce('token-live')

    await push.refreshToken()

    expect(relay.calls).toEqual([])
  })
})

it('does not ask again once the user has said yes: Safari refuses a second ask from one tap', async () => {
  // The tap already asked (useDevicePush). A second ask has no tap left and is answered no.
  const requestPermission = vi.fn(async () => 'denied')
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
  vi.stubGlobal('fetch', async () => ({ json: async () => ({ vapid_public_key: 'vapid' }) }))
  vi.mocked(getToken).mockResolvedValueOnce('token-new')
  const push = new FrappePushNotification('mail', 'https://relay.test')
  await push.initialize(fromPartial<ServiceWorkerRegistration>({}))
  push.messaging = fromPartial({})

  const result = await push.enableNotification()

  expect(requestPermission).not.toHaveBeenCalled()
  expect(result).toEqual({ permission_granted: true, token: 'token-new' })
})
