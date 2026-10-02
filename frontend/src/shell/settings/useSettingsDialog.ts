import { computed, inject, shallowRef, watch, type Ref } from 'vue'

import { useSession } from '@/platform/session'

import {
  SETTINGS_GROUPS_KEY,
  visibleSettingsGroups,
  type SettingsGroup,
  type SettingsGroupLoader,
  type VisibleSettingsGroup,
} from '@/shell/settings/settings'

export { openSettings, settingsTab, showSettings } from '@/platform/settings'

interface ResolvedList {
  /** The visible groups, with their conditions read when the load settled. */
  groups: VisibleSettingsGroup[]
  /** How many group modules failed to load and have no earlier copy to show. */
  failed: number
}

// The last resolved list, kept across opens: a second open shows it at once
// and swaps in the new list only when the new load settles, so no row moves
// while the conditions refresh.
const resolved = shallowRef<ResolvedList | null>(null)
// The last group each loader resolved to. A loader that fails on a later
// open shows this copy again.
const lastGroups = new Map<SettingsGroupLoader, SettingsGroup>()

/**
 * The settings groups the user may see. `load()` resolves every group loader
 * again: call it when Settings opens. A group whose module fails to load
 * shows its last loaded copy. With no copy, it counts in `failed`, and the
 * list shows a Retry row in its place.
 */
export function useSettingsGroups(
  loaders: readonly SettingsGroupLoader[] = inject(SETTINGS_GROUPS_KEY, []),
): {
  groups: Readonly<Ref<VisibleSettingsGroup[] | null>>
  failed: Readonly<Ref<number>>
  load: () => Promise<void>
} {
  const groups = computed(() => resolved.value?.groups ?? null)
  const failed = computed(() => resolved.value?.failed ?? 0)

  async function load() {
    // Group conditions read the session capabilities, so wait for them.
    await sessionSettled()
    const results = await Promise.allSettled(loaders.map((loader) => loader()))
    let failures = 0
    const loaded = results.flatMap((result, index) => {
      const loader = loaders[index]!
      if (result.status === 'fulfilled') {
        lastGroups.set(loader, result.value)
        return [result.value]
      }
      console.error('A settings group failed to load', result.reason)
      const earlier = lastGroups.get(loader)
      if (earlier) return [earlier]
      failures += 1
      return []
    })
    resolved.value = { groups: visibleSettingsGroups(loaded), failed: failures }
  }

  return { groups, failed, load }
}

function sessionSettled(): Promise<void> {
  const { status } = useSession()
  if (status.value !== 'loading') return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(status, (value) => {
      if (value === 'loading') return
      stop()
      resolve()
    })
  })
}
