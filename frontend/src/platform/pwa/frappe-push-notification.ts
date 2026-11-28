import { initializeApp } from 'firebase/app'
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage as onFCMMessage,
  type MessagePayload,
  type Messaging,
} from 'firebase/messaging'

import { api, client } from '@/api'

// FCM web config to initialize firebase app
type WebConfigType = {
  projectId: string
  appId: string
  apiKey: string
  authDomain: string
  messagingSenderId: string
}

type OnMessageCallback = (payload: MessagePayload) => void

class FrappePushNotification {
  // client info
  projectName: string
  relayURL: string
  // The apps this device is notified for (see suite.suite_core.push).
  apps: string[]
  webConfig: WebConfigType | null
  vapidPublicKey: string
  token: string | null

  // state
  initialized: boolean
  messaging: Messaging | null
  serviceWorkerRegistration: ServiceWorkerRegistration | null

  // event handlers
  onMessageHandler: OnMessageCallback | null

  // `relayURL` is the notification relay's base URL. The caller checks that the site has one.
  constructor(projectName: string, relayURL: string, apps: string[] = ['mail']) {
    // client info
    this.projectName = projectName
    this.relayURL = relayURL
    this.apps = apps
    this.webConfig = null
    this.vapidPublicKey = ''
    this.token = null

    // state
    this.initialized = false
    this.messaging = null
    this.serviceWorkerRegistration = null

    // event handlers
    this.onMessageHandler = null
  }

  // Initialize notification service client
  async initialize(serviceWorkerRegistration: ServiceWorkerRegistration): Promise<void> {
    if (this.initialized) return

    this.serviceWorkerRegistration = serviceWorkerRegistration
    // getMessaging starts its own isSupported check and nobody catches its rejection, as on
    // iPhone Safari outside the home screen. Asking first keeps messaging off there.
    if (!(await isSupported())) return
    const config = await this.fetchWebConfig()
    this.messaging = getMessaging(initializeApp(config))
    this.onMessage(this.onMessageHandler)
    this.initialized = true
  }

  // Append config to service worker URL
  async appendConfigToServiceWorkerURL(url: string, parameter_name = 'config'): Promise<string> {
    const config = await this.fetchWebConfig()
    const encode_config = encodeURIComponent(JSON.stringify(config))
    return `${url}?${parameter_name}=${encode_config}`
  }

  // Fetch web config of the project
  async fetchWebConfig(): Promise<WebConfigType> {
    if (this.webConfig !== null && this.webConfig !== undefined) return this.webConfig

    const url = `${this.relayURL}/api/method/notification_relay.api.get_config?project_name=${this.projectName}`
    const response = await fetch(url)
    const response_json = await response.json()
    this.webConfig = response_json.config
    return this.webConfig!
  }

  // Fetch VAPID public key
  async fetchVapidPublicKey(): Promise<string> {
    if (this.vapidPublicKey !== '') return this.vapidPublicKey

    const url = `${this.relayURL}/api/method/notification_relay.api.get_config?project_name=${this.projectName}`
    const response = await fetch(url)
    const response_json = await response.json()
    this.vapidPublicKey = response_json.vapid_public_key
    return this.vapidPublicKey
  }

  // Register on message handler
  onMessage(callback: OnMessageCallback | null): void {
    if (callback == null) return
    this.onMessageHandler = callback
    if (this.messaging == null) return
    onFCMMessage(this.messaging, this.onMessageHandler)
  }

  // Check if notification is enabled
  isNotificationEnabled() {
    return localStorage.getItem(`firebase_token_${this.projectName}`) !== null
  }

  // This will return notification permission status and token
  async enableNotification(): Promise<{ permission_granted: boolean; token: string }> {
    if (!(await isSupported()))
      throw new Error('Push notifications are not supported on your device')

    // Return if token already presence in the instance
    if (this.token != null) return { permission_granted: true, token: this.token }

    // Safari answers no to a page that asks twice from one tap, even when the user already said
    // yes, and the tap that got here has asked (see useDevicePush). So ask only if still undecided.
    const permission =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') return { permission_granted: false, token: '' }

    const token = await this.currentToken()
    await this.syncApps()
    return { permission_granted: true, token }
  }

  /**
   * Asks Firebase for this device's token again, on a device already notified. Firebase makes a
   * new push subscription when the browser dropped the old one, as Safari does, and renews a
   * token that has aged; the relay hears of a new token, so the device is notified again.
   */
  async refreshToken(): Promise<void> {
    if (!this.messaging || !this.isNotificationEnabled()) return
    if (Notification.permission !== 'granted') return
    await this.currentToken()
  }

  // This device's token from Firebase, subscribed at the relay in place of the old one.
  async currentToken(): Promise<string> {
    const oldToken = localStorage.getItem(`firebase_token_${this.projectName}`)
    const vapidKey = await this.fetchVapidPublicKey()
    const newToken = await getToken(this.messaging!, {
      vapidKey: vapidKey,
      serviceWorkerRegistration: this.serviceWorkerRegistration!,
    })
    if (oldToken !== newToken) {
      if (oldToken) await this.unregisterTokenHandler(oldToken, this.registeredApps())

      if (!(await this.registerTokenHandler(newToken, this.apps)))
        throw new Error('Failed to subscribe to push notification')

      localStorage.setItem(`firebase_token_${this.projectName}`, newToken)
      this.saveRegisteredApps(this.apps)
    }
    this.token = newToken
    return newToken
  }

  // This will delete token from firebase and unsubscribe from push notification
  async disableNotification(): Promise<void> {
    if (this.token == null)
      // try to fetch token from local storage
      this.token = localStorage.getItem(`firebase_token_${this.projectName}`)
    if (this.token == null || this.token === '') return

    // delete old token from firebase
    try {
      await deleteToken(this.messaging!)
    } catch (e) {
      console.error('Failed to delete token from firebase')
      console.error(e)
    }
    try {
      await this.unregisterTokenHandler(this.token, this.registeredApps())
    } catch (e) {
      console.error('Failed to unsubscribe from push notification')
      console.error(e)
    }
    // remove token
    localStorage.removeItem(`firebase_token_${this.projectName}`)
    localStorage.removeItem(this.appsKey)
    this.token = null
  }

  // Delete this browser's token at Firebase and forget it here, without a server call.
  // For a token another user left behind: this user's session cannot unsubscribe it.
  async forgetToken(): Promise<void> {
    try {
      await deleteToken(this.messaging!)
    } catch (e) {
      console.error('Failed to delete token from firebase')
      console.error(e)
    }
    localStorage.removeItem(`firebase_token_${this.projectName}`)
    localStorage.removeItem(this.appsKey)
    this.token = null
  }

  /**
   * Subscribes this device's token for any of `apps` it is not subscribed for yet: an app
   * installed after notifications were turned on, or a token from before subscriptions were per
   * app, which the relay knew as Mail's. That older token, found inside another app installed on
   * its own, lets Mail go: there it would bring Mail's notifications into Calendar.
   */
  async syncApps(): Promise<void> {
    const token = this.token ?? localStorage.getItem(`firebase_token_${this.projectName}`)
    if (!token) return
    let registered = this.registeredApps()
    const stray =
      localStorage.getItem(this.appsKey) === null
        ? registered.filter((app) => !this.apps.includes(app))
        : []
    if (stray.length && (await this.unregisterTokenHandler(token, stray))) {
      registered = registered.filter((app) => !stray.includes(app))
      this.saveRegisteredApps(registered)
    }
    const missing = this.apps.filter((app) => !registered.includes(app))
    if (!missing.length) return
    if (await this.registerTokenHandler(token, missing))
      this.saveRegisteredApps([...registered, ...missing])
  }

  // The apps this browser's token is subscribed for. A token from before subscriptions were per
  // app was Mail's.
  get appsKey(): string {
    return `firebase_token_apps_${this.projectName}`
  }
  registeredApps(): string[] {
    try {
      const apps: unknown = JSON.parse(localStorage.getItem(this.appsKey) ?? '["mail"]')
      return Array.isArray(apps) ? apps.filter((app) => typeof app === 'string') : ['mail']
    } catch {
      return ['mail']
    }
  }
  saveRegisteredApps(apps: string[]): void {
    localStorage.setItem(this.appsKey, JSON.stringify([...new Set(apps)]))
  }

  // Register Token Handler
  async registerTokenHandler(token: string, apps: string[] = this.apps): Promise<boolean> {
    try {
      const result = await client.mutation(
        api.suite.push.subscribe,
        {
          fcm_token: token,
          apps: apps.filter(
            (app): app is 'mail' | 'calendar' => app === 'mail' || app === 'calendar',
          ),
        },
        { silent: true },
      )
      return result.success
    } catch (e) {
      console.error(e)
      return false
    }
  }

  // Unregister Token Handler
  async unregisterTokenHandler(token: string, apps: string[] = this.apps): Promise<boolean> {
    try {
      const result = await client.mutation(
        api.suite.push.unsubscribe,
        {
          fcm_token: token,
          apps: apps.filter(
            (app): app is 'mail' | 'calendar' => app === 'mail' || app === 'calendar',
          ),
        },
        { silent: true },
      )
      return result.success
    } catch (e) {
      console.error(e)
      return false
    }
  }
}

export default FrappePushNotification
