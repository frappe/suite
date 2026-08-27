export const THEME_CYCLE = ['automatic', 'light', 'dark'] as const

export type ThemeMode = (typeof THEME_CYCLE)[number]

export function normalizeTheme(theme?: string | null): ThemeMode {
	const mode = theme?.toLowerCase()
	return THEME_CYCLE.includes(mode as ThemeMode) ? (mode as ThemeMode) : 'light'
}

export function nextTheme(theme: string): ThemeMode {
	const current = normalizeTheme(theme)
	return THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]!
}
