import { computed, ref } from 'vue'
import { frappeRequest, toast } from 'frappe-ui'
import { useSessionStore } from '@/boot/session'
import { normalizeTheme } from '@/utils/themeValues'

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

export const systemDark = ref(systemTheme.matches)
systemTheme.addEventListener('change', (e) => (systemDark.value = e.matches))

export function getThemeMode() {
	return document.documentElement.getAttribute('data-theme-mode') || 'light'
}

export const themeMode = ref(getThemeMode())
export const resolvedTheme = computed(() =>
	themeMode.value === 'automatic' ? (systemDark.value ? 'dark' : 'light') : themeMode.value,
)

let initialized = false
let saving = false
let queuedTheme = null
let persistedTheme = themeMode.value

export async function setupTheme() {
	if (initialized) return
	initialized = true

	const savedTheme = import.meta.env.DEV ? await getSavedTheme() : getThemeMode()
	applyTheme(savedTheme)
	persistedTheme = normalizeTheme(savedTheme)

	systemTheme.addEventListener('change', () => {
		if (getThemeMode() === 'automatic') applyTheme('automatic')
	})
}

export function switchTheme(theme) {
	const mode = normalizeTheme(theme)
	applyTheme(mode)
	return saveTheme(mode)
}

function applyTheme(mode) {
	mode = normalizeTheme(mode)
	const resolved = mode === 'automatic' ? systemPreference() : mode

	const root = document.documentElement
	root.classList.add('theme-switching')
	root.style.colorScheme = resolved
	root.setAttribute('data-theme', resolved)
	root.setAttribute('data-theme-mode', mode)
	const themeColor = document.querySelector('meta[name="theme-color"]')
	if (themeColor) themeColor.content = resolved === 'dark' ? '#171717' : '#ffffff'
	themeMode.value = mode

	requestAnimationFrame(() => root.classList.remove('theme-switching'))
}

function systemPreference() {
	return systemTheme.matches ? 'dark' : 'light'
}

async function getSavedTheme() {
	const session = useSessionStore()
	if (!session.isLoggedIn) return 'light'

	try {
		const value = await frappeRequest({
			url: 'frappe.client.get_value',
			params: { doctype: 'User', fieldname: 'desk_theme', filters: session.user },
		})
		return value?.desk_theme || 'light'
	} catch {
		return getThemeMode()
	}
}

async function saveTheme(theme) {
	if (!useSessionStore().isLoggedIn) return true

	queuedTheme = theme
	if (saving) return true

	saving = true
	try {
		while (queuedTheme) {
			const next = queuedTheme
			queuedTheme = null
			await frappeRequest({
				url: 'frappe.core.doctype.user.user.switch_theme',
				params: { theme: capitalize(next) },
			})
			persistedTheme = next
		}
		return true
	} catch {
		queuedTheme = null
		applyTheme(persistedTheme)
		toast.error(__('Failed to update appearance. Please try again.'))
		return false
	} finally {
		saving = false
	}
}

function capitalize(word) {
	return word.charAt(0).toUpperCase() + word.slice(1)
}
