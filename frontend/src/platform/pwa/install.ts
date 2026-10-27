import { computed, ref, shallowRef, type Ref } from 'vue'

/**
 * Offering to install an app of its own. Once, quietly: the first time an app's pages open in a
 * phone's browser a banner says it can be installed, and once dismissed it stays dismissed on that
 * device. Never inside an installed app. Inside the one Suite app installed before the split, a
 * note says once that Mail and Calendar are apps of their own now.
 *
 * Chrome says an app can be installed with `beforeinstallprompt`, once per page load and only
 * while it is not installed, so the event is caught here at boot rather than by whatever is on
 * screen. An iPhone says nothing: there the offer is the steps to Add to Home Screen.
 */

/** The Suite app's start URL (`public/pwa/suite/manifest.webmanifest`). */
const SUITE_START_URL = '/suite/start'
const DISMISSED_KEY = 'suite_install_dismissed'
const NOTE_KEY = 'suite_app_note_dismissed'
const SUITE_APP_KEY = 'suite_app_launched'

type InstallPrompt = { event: BeforeInstallPromptEvent; app: string }

const prompt = shallowRef<InstallPrompt | null>(null)
const dismissed = ref(new Set(readList(DISMISSED_KEY)))
const noteDismissed = ref(read(NOTE_KEY) === '1')
// The app the page links, as installPwa keeps it.
const linked: { app: Readonly<Ref<string>> } = { app: ref('suite') }

/**
 * Starts listening for the browser's offer, with the app whose manifest the page links: the offer
 * installs that app. Called once, at boot, by installPwa.
 */
export function startInstallOffer(app: Readonly<Ref<string>>): void {
  linked.app = app
  window.addEventListener('beforeinstallprompt', (event) => {
    // The browser's own mini-infobar would be a second offer, on every visit.
    event.preventDefault()
    prompt.value = { event, app: app.value }
  })
  window.addEventListener('appinstalled', () => {
    prompt.value = null
  })
  // The Suite app opens at its start URL; the apps of their own open at theirs. Remembered for the
  // session, which is the app's while it runs.
  if (standalone() && window.location.pathname === SUITE_START_URL) write(SUITE_APP_KEY, '1', true)
}

export interface InstallOffer {
  /** The app this page installs as, or `suite` where none is offered. */
  app: Readonly<Ref<string>>
  /** How this page's app can be installed here: by the browser's prompt, by the iPhone's steps, or not at all. */
  how: Readonly<Ref<'prompt' | 'steps' | null>>
  /** Whether the banner is up: the first offer, until dismissed. */
  bannerOpen: Readonly<Ref<boolean>>
  /** Installs by the browser's prompt. An iPhone has none: its steps are shown, not run. */
  install: () => void
  /** Dismisses the banner for this app, on this device. */
  dismiss: () => void
  /** Whether the one-time note inside the Suite app is up. */
  suiteAppNote: Readonly<Ref<boolean>>
  dismissSuiteAppNote: () => void
}

export function useInstallOffer(): InstallOffer {
  const app = computed(() => linked.app.value)
  const how = computed(() => {
    if (app.value === 'suite' || standalone()) return null
    if (prompt.value?.app === app.value) return 'prompt'
    return onIos() ? 'steps' : null
  })
  const bannerOpen = computed(() => !!how.value && !dismissed.value.has(app.value))
  const install = () => {
    // A prompt shows once: used, it is let go, and Install is offered again only when the
    // browser offers again (a later visit, if this one was declined).
    const used = prompt.value
    prompt.value = null
    void used?.event.prompt()
  }
  const dismiss = () => {
    if (dismissed.value.has(app.value)) return
    dismissed.value = new Set([...dismissed.value, app.value])
    write(DISMISSED_KEY, JSON.stringify([...dismissed.value]))
  }
  const suiteAppNote = computed(
    () => standalone() && read(SUITE_APP_KEY, true) === '1' && !noteDismissed.value,
  )
  const dismissSuiteAppNote = () => {
    noteDismissed.value = true
    write(NOTE_KEY, '1')
  }
  return { app, how, bannerOpen, install, dismiss, suiteAppNote, dismissSuiteAppNote }
}

/** Running as an installed app rather than in a browser tab. */
export function standalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** An iPhone or iPad, whatever the browser: they are all WebKit, and none can prompt. */
export function onIos(): boolean {
  const { userAgent, maxTouchPoints } = navigator
  // iPadOS asks for desktop pages as a Mac; only its touch screen tells it apart.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}

// Storage can be unavailable (private mode); the offer then comes back with the next visit.
function read(key: string, session = false): string | null {
  try {
    return (session ? sessionStorage : localStorage).getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string, session = false): void {
  try {
    ;(session ? sessionStorage : localStorage).setItem(key, value)
  } catch {
    // As above.
  }
}
function readList(key: string): string[] {
  try {
    const list = JSON.parse(read(key) ?? '[]') as unknown
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}
