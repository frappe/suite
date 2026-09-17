import { ref } from 'vue'

const showShortcuts = ref(false)

/** The shortcuts dialog, opened from `?` in the layout or the sidebar's menu. */
export const useShortcuts = () => ({
	showShortcuts,
	openShortcuts: () => (showShortcuts.value = true),
})
