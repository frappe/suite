import { readonly, ref, type Ref } from 'vue'

/**
 * How controls look under the mouse. `normal` shows the arrow on buttons,
 * menus, rows and in-app links, and the hand only on external links. `pointer`
 * keeps the hand that each component sets. The rules are in `index.css`.
 */
export type CursorMode = 'normal' | 'pointer'

export interface CursorPreference {
  mode: Readonly<Ref<CursorMode>>
  set(mode: CursorMode): void
}

/** Kept in this browser: the User doctype has no field for it. */
const KEY = 'suite.cursor'

export function createCursorPreference(): CursorPreference {
  const mode = ref<CursorMode>(read())
  const apply = () => document.documentElement.setAttribute('data-cursor', mode.value)

  // Another tab changed the preference.
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return
    mode.value = normalize(event.newValue)
    apply()
  })

  apply()
  return {
    mode: readonly(mode),
    set(next) {
      mode.value = next
      apply()
      try {
        localStorage.setItem(KEY, next)
      } catch {
        // Browser storage is best-effort. The choice still applies to this page.
      }
    },
  }
}

let singleton: CursorPreference | null = null

export function useCursor(): CursorPreference {
  singleton ??= createCursorPreference()
  return singleton
}

/** Sets the page's cursor attribute from the saved preference. Call before the app mounts. */
export function initializeCursor(): void {
  useCursor()
}

function read(): CursorMode {
  try {
    return normalize(localStorage.getItem(KEY))
  } catch {
    return 'normal'
  }
}

function normalize(value: unknown): CursorMode {
  return value === 'pointer' ? 'pointer' : 'normal'
}
