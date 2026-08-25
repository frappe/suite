import { ref, computed, nextTick } from 'vue'

export const cursorMap = {
	'top-left': 'nwse-resize',
	'top-right': 'nesw-resize',
	'bottom-left': 'nesw-resize',
	'bottom-right': 'nwse-resize',
	'text-left': 'ew-resize',
	'text-right': 'ew-resize',
	left: 'ew-resize',
	right: 'ew-resize',
	top: 'ns-resize',
	bottom: 'ns-resize',
}

export const useResizer = () => {
	const isResizing = ref(false)
	const currentResizer = ref(null)
	const isShiftHeld = ref(false)
	const isAltHeld = ref(false)
	const isMetaHeld = ref(false)

	const resizeCursor = computed(() => cursorMap[currentResizer.value] ?? 'default')

	let startX = 0
	let startY = 0
	let lastX = 0
	let lastY = 0
	let frame = null

	// total cursor movement since press (viewport px), flushed once per frame
	const pointerDelta = ref({ x: 0, y: 0 })

	const startResize = (e, resizer) => {
		e.preventDefault()
		e.stopImmediatePropagation()

		currentResizer.value = resizer
		isResizing.value = true

		startX = lastX = e.clientX
		startY = lastY = e.clientY
		pointerDelta.value = { x: 0, y: 0 }
		setModifiers(e)

		window.addEventListener('mousemove', resize)
		window.addEventListener('keydown', trackModifiers)
		window.addEventListener('keyup', trackModifiers)
		window.addEventListener('mouseup', stopResize, { once: true })
	}

	const flushResize = () => {
		frame = null
		pointerDelta.value = { x: lastX - startX, y: lastY - startY }
	}

	const setModifiers = (e) => {
		isShiftHeld.value = e.shiftKey
		isAltHeld.value = e.altKey
		isMetaHeld.value = e.metaKey || e.ctrlKey
	}

	// modifiers can change without the pointer moving, so rerun the last delta
	const trackModifiers = (e) => {
		if (!['Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) return
		setModifiers(e)
		if (!frame) frame = requestAnimationFrame(flushResize)
	}

	const resize = (e) => {
		e.preventDefault()
		e.stopImmediatePropagation()

		if (!e.buttons) return stopResize(e)

		lastX = e.clientX
		lastY = e.clientY
		setModifiers(e)

		if (!frame) frame = requestAnimationFrame(flushResize)
	}

	const stopResize = (e) => {
		e.preventDefault()
		e.stopImmediatePropagation()

		// flush movement still waiting on the next frame so the final size is exact
		if (frame) {
			cancelAnimationFrame(frame)
			flushResize()
		}

		isResizing.value = false

		// the final flush is processed by a watcher after this task, which still
		// needs to know which handle moved — clear it once that has run
		nextTick(() => {
			currentResizer.value = null
		})

		window.removeEventListener('mousemove', resize)
		window.removeEventListener('mouseup', stopResize)
		window.removeEventListener('keydown', trackModifiers)
		window.removeEventListener('keyup', trackModifiers)
	}

	return {
		isResizing,
		isShiftHeld,
		isAltHeld,
		isMetaHeld,
		pointerDelta,
		currentResizer,
		startResize,
		resizeCursor,
	}
}
