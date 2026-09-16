import { computed } from 'vue'

import { initializeTheme, resolvedMode, savedMode, setTheme } from '@/platform/theme'

export const themeMode = savedMode
export const resolvedTheme = resolvedMode
export const systemDark = computed(() =>
  typeof window === 'undefined'
    ? false
    : window.matchMedia('(prefers-color-scheme: dark)').matches,
)

export function getThemeMode() {
  return savedMode.value
}

export const setupTheme = initializeTheme
export const switchTheme = setTheme
