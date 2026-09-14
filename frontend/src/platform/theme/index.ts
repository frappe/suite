import { computed, readonly, ref, type Ref } from 'vue'

import { useSession, type Session } from '@/platform/session'
import { transport, type Operation, type Transport } from '@/platform/transport'

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

export interface CreateThemeOptions {
  transport?: Transport
  session?: Session
}

const getThemeOperation: Operation<
  { doctype: 'User'; fieldname: 'desk_theme'; filters: string },
  { desk_theme?: string }
> = {
  id: 'frappe.user.get_theme',
  owner: 'suite',
  method: 'POST',
  path: '/api/v2/method/frappe.client.get_value',
}

const setThemeOperation: Operation<{ theme: string }, unknown> = {
  id: 'frappe.user.switch_theme',
  owner: 'suite',
  method: 'POST',
  path: '/api/v2/method/frappe.core.doctype.user.user.switch_theme',
}

export function createTheme(options: CreateThemeOptions = {}): Theme {
  const client = options.transport ?? transport
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

  const resolvedMode = computed<ResolvedTheme>(() =>
    overrides.value.at(-1)?.mode ?? resolve(savedMode.value, systemDark.value),
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
          const response = await client.request(getThemeOperation, {
            doctype: 'User',
            fieldname: 'desk_theme',
            filters: session.user.value.id,
          })
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
        await client.request(setThemeOperation, { theme: capitalize(next) })
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
    const order: ThemeMode[] = ['light', 'dark', 'automatic']
    return set(order[(order.indexOf(savedMode.value) + 1) % order.length]!)
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

const singleton = createTheme()

export function useTheme(): Theme {
  return singleton
}

export const savedMode = singleton.savedMode
export const resolvedMode = singleton.resolvedMode
export const setTheme = singleton.set
export const cycleTheme = singleton.cycle
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

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
