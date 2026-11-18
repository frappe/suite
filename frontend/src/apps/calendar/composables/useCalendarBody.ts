import { onScopeDispose, watch } from 'vue'

import '@/apps/calendar/composables/useCalendarBody.css'

// How many are holding the mark: Calendar's layout and its form opened over another area can
// both be up, and the first to go must not take it from the other.
let holders = 0

/**
 * Marks <body> as Calendar's (`calendar-app`) while the calling component is mounted and `active`
 * holds, so Calendar's styles reach the frappe-ui overlays it teleports to <body>, outside its own
 * tree. Calendar's layout holds it while Calendar is open; its form opened over another area, while
 * the form is up.
 */
export function useCalendarBody(active: () => boolean = () => true): void {
  let holding = false
  const hold = (next: boolean) => {
    if (next === holding) return
    holding = next
    holders += next ? 1 : -1
    document.body.classList.toggle('calendar-app', holders > 0)
  }
  watch(active, hold, { immediate: true })
  onScopeDispose(() => hold(false))
}
