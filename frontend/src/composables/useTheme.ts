import { resolvedTheme, setupTheme, switchTheme, themeMode } from '@/utils/setupTheme'
import { cycleThemeAndAnnounce } from '@/platform/theme'

export const useTheme = () => {
	setupTheme()

	const cycleTheme = () => void cycleThemeAndAnnounce()

	return { dataTheme: resolvedTheme, themeMode, switchTheme, cycleTheme }
}
