import { cycleThemeAndAnnounce } from '@/platform/theme'
import { resolvedTheme, setupTheme, switchTheme, themeMode } from '@/utils/setupTheme'

export const useTheme = () => {
  setupTheme()

  const cycleTheme = () => void cycleThemeAndAnnounce()

  return { dataTheme: resolvedTheme, themeMode, switchTheme, cycleTheme }
}
