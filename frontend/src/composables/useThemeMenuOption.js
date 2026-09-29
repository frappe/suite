import { computed, h } from 'vue'
import { useTheme } from '@/composables/useTheme'

const themeModes = [
	{ mode: 'light', icon: 'lucide-sun', label: 'Light' },
	{ mode: 'dark', icon: 'lucide-moon', label: 'Dark' },
	{ mode: 'automatic', icon: 'lucide-monitor', label: 'Auto' },
]

export function useThemeMenuOption() {
	const { cycleTheme, themeMode } = useTheme()
	const activeTheme = computed(
		() => themeModes.find(({ mode }) => mode === themeMode.value) || themeModes[0],
	)

	return {
		label: 'Theme',
		icon: 'lucide-sun-moon',
		onClick: (event) => {
			event.preventDefault()
			cycleTheme()
		},
		slots: {
			label: () => h('div', { class: 'min-w-20 truncate' }, 'Theme'),
			suffix: () =>
				h(
					'span',
					{ class: 'flex w-16 items-center justify-end gap-2 text-ink-gray-5' },
					[
						h('span', activeTheme.value.label),
						h('span', { class: [activeTheme.value.icon, 'size-4'] }),
					],
				),
		},
	}
}
