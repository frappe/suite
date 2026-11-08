import { afterAll, expect, it, vi } from 'vitest'

const boot = vi.hoisted(() => {
  let release = () => {}
  const translations = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    translations,
    release: () => release(),
    installEventReminders: vi.fn(),
    preloadPage: vi.fn(),
    rendered: vi.fn(),
  }
})

vi.mock('./index.css', () => ({}))
vi.mock('@/App.vue', () => ({
  default: {
    render: () => {
      boot.rendered()
      return null
    },
  },
}))
vi.mock('@/apps/calendar', () => ({ installEventReminders: boot.installEventReminders }))
vi.mock('@/apps/slides/utils/serviceWorker', () => ({ clearSlidesUserData: vi.fn() }))
vi.mock('@/boot/sentry', () => ({ initSentry: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/boot/config', () => ({}))
vi.mock('@/composition/documentRegistry', () => ({ documentTypes: [] }))
vi.mock('@/platform/build', () => ({ watchBuild: vi.fn() }))
vi.mock('@/platform/cursor', () => ({ initializeCursor: vi.fn() }))
vi.mock('@/platform/error-log', () => ({ installErrorLog: vi.fn() }))
vi.mock('@/platform/server-state', () => ({ installApiErrorHandler: vi.fn() }))
vi.mock('@/platform/session', () => ({ useSession: () => ({ onLogout: vi.fn() }) }))
vi.mock('@/platform/theme', () => ({ initializeTheme: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/platform/time-zone', () => ({ installUserTimeZone: vi.fn() }))
vi.mock('@/platform/translation', async () => ({
  ...(await vi.importActual<typeof import('@/platform/translation')>('@/platform/translation')),
  ready: boot.translations,
}))
vi.mock('@/router', () => ({
  default: { install: vi.fn(), isReady: () => Promise.resolve(), push: vi.fn() },
  preloadPage: boot.preloadPage,
}))
vi.mock('@/shell/ShellLayout.vue', () => ({ default: {} }))

const originalTranslate = window.__

afterAll(() => {
  window.__ = originalTranslate
})

it(
  'loads a page’s code only once the global __ and the catalog are there',
  { timeout: 30_000 },
  async () => {
    document.body.innerHTML = '<div id="app"></div>'
    delete window.__
    const seen: string[] = []
    boot.preloadPage.mockImplementation(() => seen.push(typeof window.__))

    const started = import('./main')
    await vi.waitFor(() => expect(boot.installEventReminders).toHaveBeenCalled())

    // The catalog is still on its way, so a page evaluated now would freeze English labels.
    expect(boot.preloadPage).not.toHaveBeenCalled()

    boot.release()
    await started

    expect(seen).toEqual(['function'])
    // The app mounts after the sprite plugin's import, so nothing is left loading after the test.
    await vi.waitFor(() => expect(boot.rendered).toHaveBeenCalled(), { timeout: 25_000 })
  },
)
