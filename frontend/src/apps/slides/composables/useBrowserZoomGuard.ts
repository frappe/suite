import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'

const blockBrowserZoom = (e: WheelEvent) => {
	if (e.ctrlKey || e.metaKey) e.preventDefault()
}

const addGuard = () =>
	window.addEventListener('wheel', blockBrowserZoom, { passive: false, capture: true })

const removeGuard = () => window.removeEventListener('wheel', blockBrowserZoom, { capture: true })

export const useBrowserZoomGuard = () => {
	onMounted(addGuard)
	onActivated(addGuard)
	onDeactivated(removeGuard)
	onBeforeUnmount(removeGuard)
}
