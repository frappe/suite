import { toast } from 'frappe-ui'
import { resolvedTheme, setupTheme, switchTheme, themeMode } from '@/utils/setupTheme'
import { nextTheme } from '@/utils/themeValues'

export const useTheme = () => {
	setupTheme()

	const cycleTheme = () => {
		const next = nextTheme(themeMode.value)
		switchTheme(next)
		toast.success(__('Appearance updated to {0}.', [__(next === 'automatic' ? 'Automatic' : next)]))
	}

	return { dataTheme: resolvedTheme, themeMode, switchTheme, cycleTheme }
}
