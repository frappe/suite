import type { AsyncComponentLoader } from 'vue'

import { whenIdle } from '@/platform/idle'
import type { SettingsTab } from '@/shell/settings/settings'

type BodyLoad = ReturnType<AsyncComponentLoader>

// One load per tab for the whole session, shared by an early load and the tab's own opening.
const loads = new Map<string, BodyLoad>()

/** A tab's body, loaded once: a second call gets the first call's load. */
export function loadTabBody(tab: SettingsTab): BodyLoad {
  let load = loads.get(tab.id)
  if (!load) {
    load = tab.body()
    // A failed load is tried again when the tab opens.
    load.catch(() => loads.delete(tab.id))
    loads.set(tab.id, load)
  }
  return load
}

/**
 * Loads the bodies of the tabs on a Settings list while the page is idle, so a row opens its page
 * at once rather than on a loading state first.
 */
export function preloadTabBodies(tabs: () => readonly SettingsTab[]): void {
  whenIdle(() => {
    for (const tab of tabs()) void loadTabBody(tab).catch(() => undefined)
  })
}
