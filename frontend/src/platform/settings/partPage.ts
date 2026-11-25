import { onBeforeUnmount, onMounted, ref } from 'vue'

import { slideChange } from '@/platform/page-slide'

// The history entries part pages have pushed over their tab's page and not yet left. Settings
// counts them in with its own when it closes from outside and drops what it pushed.
let partEntries = 0
export const settingsPartEntries = () => partEntries

/**
 * A part of a Settings tab shown as a page of its own on a phone, such as the list of folders: it
 * slides in as every phone page does and takes a step in history, so the phone's back gesture
 * leaves it as its Back arrow does, for the tab's page it came from.
 *
 * Every way out goes through that step: `close` steps back, and the page goes as history arrives
 * there.
 */
export function useSettingsPartPage() {
  const shown = ref(false)
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  let pushed = false

  function open() {
    if (shown.value) return
    void slideChange('forward', () => {
      shown.value = true
    })
    // Keeps the router's and Settings' own state, so each sees the same place under this step.
    history.pushState(
      {
        ...(history.state && typeof history.state === 'object' ? history.state : null),
        suiteSettingsPart: id,
      },
      '',
    )
    pushed = true
    partEntries += 1
  }

  function close() {
    if (pushed) history.back()
    else shown.value = false
  }

  function onPopState(event: PopStateEvent) {
    if (!pushed) return
    const state: unknown = event.state
    if (state && typeof state === 'object' && 'suiteSettingsPart' in state) {
      if (state.suiteSettingsPart === id) return
    }
    pushed = false
    partEntries -= 1
    void slideChange('back', () => {
      shown.value = false
    })
  }

  onMounted(() => window.addEventListener('popstate', onPopState))
  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState)
    // Gone with its tab's page: whatever took that page away takes this step with it.
    if (pushed) partEntries -= 1
  })

  return { shown, open, close }
}
