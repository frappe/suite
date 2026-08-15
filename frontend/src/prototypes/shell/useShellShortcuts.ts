// PROTOTYPE — remove. Shell-wide keyboard shortcuts. Holding Cmd reveals the
// hints on the rail, and Cmd+<number> jumps to the area at that position.
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { NAV_ITEMS, type AreaId } from './fixtures'

/** True while Cmd (or Ctrl) is down, so the rail can show its hints. */
export const modifierHeld = ref(false)

// The rail order is the shortcut order: Home 1, Files 2, Mail 3, Calendar 4.
// Both the hints and the handler read this one map, so they cannot drift.
const KEY_BY_AREA = new Map(NAV_ITEMS.map((item, i) => [item.id, String(i + 1)]))
const AREA_BY_KEY = new Map(NAV_ITEMS.map((item, i) => [String(i + 1), item.id]))

export function shortcutFor(area: AreaId) {
  return KEY_BY_AREA.get(area) ?? ''
}

export function useShellShortcuts(go: (area: AreaId) => void) {
  function onKeydown(e: KeyboardEvent) {
    const held = e.metaKey || e.ctrlKey
    modifierHeld.value = held
    if (!held) return
    const area = AREA_BY_KEY.get(e.key)
    if (!area) return
    e.preventDefault()
    go(area)
  }

  function onKeyup(e: KeyboardEvent) {
    modifierHeld.value = e.metaKey || e.ctrlKey
  }

  // Cmd+Tab to another app never delivers the keyup, so the hints would stay
  // on screen until the next keypress.
  function clear() {
    modifierHeld.value = false
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('keyup', onKeyup)
    window.addEventListener('blur', clear)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('keyup', onKeyup)
    window.removeEventListener('blur', clear)
  })
}
