import { useStorage } from '@vueuse/core'
import { computed, type Ref } from 'vue'

/**
 * The look-and-feel choices of the search view still to be made, and what each is until it is. A
 * development build lets them be flipped from the Tweak panel (see SearchTweakPanel); a production
 * build only ever has the defaults, and carries neither the storage nor the panel.
 */
export const SEARCH_TWEAKS = {
  match: {
    label: 'How a match shows',
    options: [
      { value: 'line', label: 'One line + "also in"' },
      { value: 'lines', label: 'Two-line snippet' },
      { value: 'messages', label: 'Each matching message' },
    ],
    default: 'line',
  },
  filters: {
    label: 'Where filters sit',
    options: [
      { value: 'pills', label: 'Pills under the search box' },
      { value: 'menu', label: 'One Filters button' },
    ],
    default: 'pills',
  },
  opening: {
    label: 'Opening a result (no split view)',
    options: [
      { value: 'beside', label: 'Beside the results' },
      { value: 'over', label: 'Over the results' },
    ],
    default: 'beside',
  },
} as const

type TweakKey = keyof typeof SEARCH_TWEAKS
type Tweaks = { [K in TweakKey]: (typeof SEARCH_TWEAKS)[K]['options'][number]['value'] }

const defaults = Object.fromEntries(
  Object.entries(SEARCH_TWEAKS).map(([key, tweak]) => [key, tweak.default]),
) as Tweaks

const tweaks: Ref<Tweaks> | null = import.meta.env.DEV
  ? useStorage<Tweaks>('mail-search-tweaks', defaults, undefined, { mergeDefaults: true })
  : null

export const useSearchTweaks = () => {
  const current = computed(() => tweaks?.value ?? defaults)
  return {
    tweaks: current,
    set: <K extends TweakKey>(key: K, value: Tweaks[K]) => {
      if (tweaks) tweaks.value = { ...tweaks.value, [key]: value }
    },
  }
}
