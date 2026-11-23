import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'

/** A page in a phone's browser, or in an installed app, linking `app`'s manifest. */
async function open({
  app = 'mail',
  phone = PIXEL,
  installed = false,
  path = '/mail',
}: { app?: string; phone?: string; installed?: boolean; path?: string } = {}) {
  vi.resetModules()
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(phone)
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: installed })
  window.history.replaceState(null, '', path)
  const linked = ref(app)
  const module = await import('./install')
  module.startInstallOffer(linked)
  return { linked, offer: module.useInstallOffer() }
}

/** Chrome says the page's app can be installed. */
function browserOffers() {
  const prompt = vi.fn(async () => {})
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt })
  window.dispatchEvent(event)
  return { prompt, event }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'standalone')
  vi.restoreAllMocks()
})

describe('the offer to install an app of its own', () => {
  it("installs the page's app with the browser's prompt, keeping the browser's own banner away", async () => {
    const { offer } = await open()
    expect(offer.bannerOpen.value).toBe(false)

    const { prompt, event } = browserOffers()
    expect(event.defaultPrevented).toBe(true)
    expect(offer.how.value).toBe('prompt')
    expect(offer.bannerOpen.value).toBe(true)

    offer.install()
    expect(prompt).toHaveBeenCalled()
    // Declined or not, that prompt is spent: nothing offers Install until the browser does again.
    expect(offer.how.value).toBe(null)
    expect(offer.bannerOpen.value).toBe(false)
    browserOffers()
    expect(offer.how.value).toBe('prompt')
  })

  it('is offered once: dismissed, it stays dismissed on the device, for that app only', async () => {
    const first = await open()
    browserOffers()
    first.offer.dismiss()
    expect(first.offer.bannerOpen.value).toBe(false)

    // The next visit, to Mail and then to Calendar.
    const again = await open()
    browserOffers()
    expect(again.offer.bannerOpen.value).toBe(false)
    expect(again.offer.how.value).toBe('prompt')

    const calendar = await open({ app: 'calendar', path: '/calendar' })
    browserOffers()
    expect(calendar.offer.bannerOpen.value).toBe(true)
  })

  it("does not offer an app with another app's prompt", async () => {
    const { linked, offer } = await open({ app: 'suite', path: '/home' })
    browserOffers()
    linked.value = 'mail'
    expect(offer.how.value).toBe(null)
    expect(offer.bannerOpen.value).toBe(false)
  })

  it('shows an iPhone the steps, until they are dismissed', async () => {
    const { offer } = await open({ phone: IPHONE })
    expect(offer.how.value).toBe('steps')
    expect(offer.bannerOpen.value).toBe(true)

    offer.dismiss()
    expect(offer.bannerOpen.value).toBe(false)
  })

  it('offers nothing inside an installed app, nor the Suite itself', async () => {
    const installed = await open({ phone: IPHONE, installed: true })
    expect(installed.offer.how.value).toBe(null)

    const home = await open({ app: 'suite', phone: IPHONE, path: '/home' })
    expect(home.offer.how.value).toBe(null)
  })
})

describe('the note inside the one Suite app', () => {
  it('says once that the apps are their own now, in the Suite app only', async () => {
    const suiteApp = await open({ app: 'suite', installed: true, path: '/suite/start' })
    expect(suiteApp.offer.suiteAppNote.value).toBe(true)
    suiteApp.offer.dismissSuiteAppNote()
    expect(suiteApp.offer.suiteAppNote.value).toBe(false)

    // The Suite app again, the next day: the note stays dismissed.
    sessionStorage.clear()
    const nextDay = await open({ app: 'suite', installed: true, path: '/suite/start' })
    expect(nextDay.offer.suiteAppNote.value).toBe(false)
  })

  it('is not in the Mail app, nor in a browser', async () => {
    const mailApp = await open({ installed: true, path: '/mail' })
    expect(mailApp.offer.suiteAppNote.value).toBe(false)

    sessionStorage.clear()
    const browser = await open({ app: 'suite', path: '/suite/start' })
    expect(browser.offer.suiteAppNote.value).toBe(false)
  })
})
