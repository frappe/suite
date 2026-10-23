import { computed, readonly, ref, type Ref } from 'vue'

import { useSession, type Session } from '@/platform/session'

export type ThemeMode = 'light' | 'dark' | 'automatic'
export type ResolvedTheme = 'light' | 'dark'

export interface Theme {
  savedMode: Readonly<Ref<ThemeMode>>
  resolvedMode: Readonly<Ref<ResolvedTheme>>
  initialize(): Promise<void>
  set(mode: ThemeMode): Promise<boolean>
  cycle(): Promise<boolean>
  withOverride(mode: ResolvedTheme): () => void
}

export interface ThemePreferences {
  read(): Promise<{ desk_theme?: string | null }>
  save(theme: 'Light' | 'Dark' | 'Automatic'): Promise<unknown>
}
export interface CreateThemeOptions {
  preferences?: ThemePreferences
  session?: Session
}
let preferences: ThemePreferences | undefined
export function registerThemePreferences(client: ThemePreferences): void {
  preferences = client
}

export function createTheme(options: CreateThemeOptions = {}): Theme {
  const session = options.session ?? useSession()
  const media =
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? null
      : window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(media?.matches ?? false)
  const savedMode = ref<ThemeMode>(readDocumentMode())
  const overrides = ref<Array<{ id: symbol; mode: ResolvedTheme }>>([])
  let initialized: Promise<void> | null = null
  let saveQueue = Promise.resolve(true)

  const resolvedMode = computed<ResolvedTheme>(
    () => overrides.value.at(-1)?.mode ?? resolve(savedMode.value, systemDark.value),
  )

  const apply = () => applyDocumentTheme(savedMode.value, resolvedMode.value)
  media?.addEventListener('change', (event) => {
    systemDark.value = event.matches
    apply()
  })

  async function initialize(): Promise<void> {
    if (initialized) return initialized
    initialized = (async () => {
      if (session.user.value) {
        try {
          const response = await (options.preferences ?? preferences)?.read()
          savedMode.value = normalizeTheme(response?.desk_theme)
        } catch {
          // Keep the server-rendered mode when the preference endpoint is unavailable.
        }
      }
      apply()
    })()
    return initialized
  }

  async function set(mode: ThemeMode): Promise<boolean> {
    const next = normalizeTheme(mode)
    const previous = savedMode.value
    savedMode.value = next
    apply()
    if (!session.user.value) return true

    saveQueue = saveQueue.then(async () => {
      try {
        const client = options.preferences ?? preferences
        if (!client) throw new Error('Theme preferences are not registered')
        await client.save(next === 'dark' ? 'Dark' : next === 'automatic' ? 'Automatic' : 'Light')
        return true
      } catch {
        if (savedMode.value === next) {
          savedMode.value = previous
          apply()
        }
        return false
      }
    })
    return saveQueue
  }

  function cycle(): Promise<boolean> {
    return set(nextThemeMode(savedMode.value))
  }

  function withOverride(mode: ResolvedTheme): () => void {
    const item = { id: Symbol('theme-override'), mode }
    overrides.value.push(item)
    apply()
    let active = true
    return () => {
      if (!active) return
      active = false
      const index = overrides.value.findIndex(({ id }) => id === item.id)
      if (index !== -1) overrides.value.splice(index, 1)
      apply()
    }
  }

  apply()
  return {
    savedMode: readonly(savedMode),
    resolvedMode: readonly(resolvedMode),
    initialize,
    set,
    cycle,
    withOverride,
  }
}

const themeCycle: readonly ThemeMode[] = ['light', 'dark', 'automatic']

/** The mode `cycle` moves to from `mode`. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return themeCycle[(themeCycle.indexOf(mode) + 1) % themeCycle.length]!
}

const singleton = createTheme()

export function useTheme(): Theme {
  return singleton
}

export const savedMode = singleton.savedMode
export const resolvedMode = singleton.resolvedMode
export const setTheme = singleton.set
export const cycleTheme = singleton.cycle

/**
 * Moves to the next mode and says in a toast which one it moved to, for the theme shortcut and
 * menu items, which change the page without showing the mode they chose. A save that fails puts
 * the previous mode back, so that is what the toast reports instead.
 */
export async function cycleThemeAndAnnounce(): Promise<void> {
  // Loaded here, not at the top: `main.ts` loads this module on every page, and a static
  // import would put frappe-ui's dialog and toast stack in the first download.
  const { toast } = await import('@/platform/feedback')
  if (!(await singleton.cycle())) {
    toast.error(__('Could not save the theme'))
    return
  }
  const mode = singleton.savedMode.value
  toast.success(
    mode === 'automatic'
      ? __('Theme set to follow your system')
      : __('Theme changed to {0}', [__(mode === 'light' ? 'Light' : 'Dark')]),
  )
}
export const withOverride = singleton.withOverride
export const initializeTheme = singleton.initialize

function normalizeTheme(value: unknown): ThemeMode {
  const mode = typeof value === 'string' ? value.toLowerCase() : ''
  if (mode === 'dark') return 'dark'
  if (mode === 'automatic' || mode === 'system') return 'automatic'
  return 'light'
}

function readDocumentMode(): ThemeMode {
  if (typeof document === 'undefined') return 'light'
  return normalizeTheme(document.documentElement.getAttribute('data-theme-mode'))
}

function resolve(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  return mode === 'automatic' ? (systemDark ? 'dark' : 'light') : mode
}

function applyDocumentTheme(saved: ThemeMode, resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.colorScheme = resolved
  root.setAttribute('data-theme', resolved)
  root.setAttribute('data-theme-mode', saved)
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColor) themeColor.content = resolved === 'dark' ? '#171717' : '#ffffff'
}
