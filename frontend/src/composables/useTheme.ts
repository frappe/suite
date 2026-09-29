import { toast } from 'frappe-ui'
import { resolvedTheme, setupTheme, switchTheme, themeMode } from '@/utils/setupTheme'
import { nextTheme } from '@/utils/themeValues'

export const useTheme = () => {
	setupTheme()

	const cycleTheme = () => {
		const next = nextTheme(themeMode.value)
		switchTheme(next)
		toast.success(
			next === 'automatic'
				? __('Theme set to follow your system')
				: __('Theme changed to {0}', [__(next === 'light' ? 'Light' : 'Dark')]),
		)
	}

	return { dataTheme: resolvedTheme, themeMode, switchTheme, cycleTheme }
}
