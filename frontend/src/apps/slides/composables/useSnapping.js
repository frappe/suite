import { reactive, computed, watch } from 'vue'
import { selectionBounds, currentSlide, slideBounds } from '../stores/slide'
import { activeElementIds, pairElementId } from '../stores/element'
import { getElementDiv } from '../stores/elementRegistry'
import { getBoundTargetIds } from '../utils/connectors'

export const useSnapping = (selectionRef, currentResizer, hasOngoingInteraction) => {
	const RELEASE_FACTOR = 1.25

	// the edges / centers a rect can align by
	const X_LINES = ['left', 'right', 'centerX']
	const Y_LINES = ['top', 'bottom', 'centerY']

	// every [selection line, neighbour line] pair can align
	const X_ALIGNMENTS = [
		['left', 'left'],
		['left', 'right'],
		['right', 'left'],
		['right', 'right'],
		['centerX', 'centerX'],
	]
	const Y_ALIGNMENTS = [
		['top', 'top'],
		['top', 'bottom'],
		['bottom', 'top'],
		['bottom', 'bottom'],
		['centerY', 'centerY'],
	]

	const isSnapping = () => selectionRef.value && hasOngoingInteraction.value

	const neighbourRects = new Map()

	// for all neighbous, the rects don't change during gesture
	// so cache them in the start until gesture ends
	const cacheNeighbourRects = () => {
		neighbourRects.clear()

		currentSlide.value?.elements.forEach((element) => {
			if (activeElementIds.value.includes(element.id)) return
			// a connector following the gesture is moving too
			if (getBoundTargetIds(element.connector).some((id) => activeElementIds.value.includes(id)))
				return

			const div = getElementDiv(element.id)
			if (!div) return

			const r = div.getBoundingClientRect()
			neighbourRects.set(element.id, {
				left: r.left,
				right: r.right,
				top: r.top,
				bottom: r.bottom,
				centerX: (r.left + r.right) / 2,
				centerY: (r.top + r.bottom) / 2,
			})
		})
	}

	watch(hasOngoingInteraction, (ongoing) => {
		if (ongoing) return cacheNeighbourRects()
		neighbourRects.clear()
		clearSnap()
	})

	// pan / zoom moves the cached rects on screen — resnapshot
	watch(
		() => [slideBounds.left, slideBounds.top, slideBounds.scale],
		() => isSnapping() && cacheNeighbourRects(),
	)

	const toScreenRect = (rect) => {
		const scale = slideBounds.scale
		const left = slideBounds.left + rect.left * scale
		const top = slideBounds.top + rect.top * scale
		const right = left + rect.width * scale
		const bottom = top + rect.height * scale
		return {
			left,
			top,
			right,
			bottom,
			centerX: (left + right) / 2,
			centerY: (top + bottom) / 2,
		}
	}

	const getSlideCenter = () => ({
		x: slideBounds.left + slideBounds.width / 2,
		y: slideBounds.top + slideBounds.height / 2,
	})

	const getThreshold = () => {
		const height = selectionBounds.height * slideBounds.scale * 0.1
		const min = height > 50 ? height / 6 : height / 5
		const max = height > 50 ? height / 4 : height / 3
		return Math.max(min, Math.min(max, height))
	}

	const getMovingLine = (axis) => {
		const handle = currentResizer.value || ''
		if (axis === 'x')
			return handle.includes('left') ? 'left' : handle.includes('right') ? 'right' : null
		return handle.includes('top') ? 'top' : handle.includes('bottom') ? 'bottom' : null
	}

	// a candidate snap: the selection's `selectionLine` (e.g. its left edge or
	// centerX) could land on a `guideLine` belonging to `source`. it stores:
	//   key    — unique per candidate, so the hysteresis can re-find it
	//   source — 'slide' | 'element' (what the guide belongs to)
	//   line   — the guide line: where SnapGuides draws and what we align onto
	//   offset — px to move the selection so its line lands on the guide
	const createAlignment = (
		source,
		selectionLine,
		guideLine,
		guidePosition,
		selectionPosition,
	) => ({
		key: `${source}:${guideLine}:${selectionLine}`,
		source,
		line: guideLine,
		offset: guidePosition - selectionPosition,
	})

	const getNeighbourAlignmentsForDrag = (selectionScreenRect, neighbour) => {
		const make = ([selectionLine, guideLine]) =>
			createAlignment(
				'element',
				selectionLine,
				guideLine,
				neighbour[guideLine],
				selectionScreenRect[selectionLine],
			)
		return {
			x: X_ALIGNMENTS.map(make),
			y: Y_ALIGNMENTS.map(make),
		}
	}

	const getNeighbourAlignmentsForResize = (selectionScreenRect, neighbour) => {
		const movingX = getMovingLine('x')
		const movingY = getMovingLine('y')
		const make = (selectionLine, guideLine) =>
			createAlignment(
				'element',
				selectionLine,
				guideLine,
				neighbour[guideLine],
				selectionScreenRect[selectionLine],
			)
		return {
			x: movingX ? X_LINES.map((guideLine) => make(movingX, guideLine)) : [],
			y: movingY ? Y_LINES.map((guideLine) => make(movingY, guideLine)) : [],
		}
	}

	const getSlideAlignmentsForDrag = (selectionScreenRect) => {
		const center = getSlideCenter()
		const x = createAlignment(
			'slide',
			'centerX',
			'centerX',
			center.x,
			selectionScreenRect.centerX,
		)
		const y = createAlignment(
			'slide',
			'centerY',
			'centerY',
			center.y,
			selectionScreenRect.centerY,
		)
		return { x: [x], y: [y] }
	}

	const getSlideAlignmentsForResize = (selectionScreenRect) => {
		const center = getSlideCenter()

		// one candidate if this axis is resizing, otherwise none
		const centerCandidates = (movingLine, guideLine, slideCenter) => {
			if (!movingLine) return []
			const selectionPosition = selectionScreenRect[movingLine]
			return [createAlignment('slide', movingLine, guideLine, slideCenter, selectionPosition)]
		}

		return {
			x: centerCandidates(getMovingLine('x'), 'centerX', center.x),
			y: centerCandidates(getMovingLine('y'), 'centerY', center.y),
		}
	}

	const getSlideAlignments = (selectionScreenRect, mode) => {
		if (mode === 'drag') return getSlideAlignmentsForDrag(selectionScreenRect)
		if (mode === 'resize') return getSlideAlignmentsForResize(selectionScreenRect)
		return { x: [], y: [] }
	}

	const getNeighbourAlignmentsBuilder = (mode) => {
		if (mode === 'drag') return getNeighbourAlignmentsForDrag
		if (mode === 'resize') return getNeighbourAlignmentsForResize
		return null
	}

	// first neighbour with any alignment in range becomes the pair (highlighted)
	const getNeighbourAlignments = (selectionScreenRect, mode) => {
		const buildAlignments = getNeighbourAlignmentsBuilder(mode)
		if (!buildAlignments) return null

		const limit = getThreshold()
		for (const [id, neighbour] of neighbourRects) {
			const aligned = buildAlignments(selectionScreenRect, neighbour)
			const inRange = [...aligned.x, ...aligned.y].some((a) => Math.abs(a.offset) < limit)
			if (inRange) {
				pairElementId.value = id
				return aligned
			}
		}
		pairElementId.value = null
		return null
	}

	// what each axis is snapped to, or null. each entry is an alignment object:
	//   { key, source: 'slide' | 'element', line, offset }
	const activeSnap = reactive({ x: null, y: null })
	const clearSnap = () => {
		activeSnap.x = null
		activeSnap.y = null
	}

	const CENTER_LINES = new Set(['centerX', 'centerY'])

	// stay on the current alignment until it leaves the release window,
	// otherwise take the nearest one within the threshold
	const chooseAlignment = (axis, alignments) => {
		const limit = getThreshold()
		const current = activeSnap[axis]
		const held = current && alignments.find((a) => a.key === current.key)
		if (held && Math.abs(held.offset) < limit * RELEASE_FACTOR) return held

		const inRange = alignments.filter((a) => Math.abs(a.offset) < limit)
		inRange.sort((a, b) => {
			const da = Math.abs(a.offset)
			const db = Math.abs(b.offset)
			if (da !== db) return da - db

			return (CENTER_LINES.has(a.line) ? 0 : 1) - (CENTER_LINES.has(b.line) ? 0 : 1)
		})
		return inRange[0] || null
	}

	// records what the axis snapped to and returns how far to move it (slide units).
	// shouldSnap is false for an aspect-locked axis (e.g. media height)
	const getSnapOffsetForAxis = (axis, alignments, shouldSnap) => {
		const chosen = shouldSnap ? chooseAlignment(axis, alignments) : null
		activeSnap[axis] = chosen
		return (chosen ? chosen.offset : 0) / slideBounds.scale
	}

	const mergeCandidates = (slide, neighbour) => {
		const neighbourCandidates = neighbour ?? { x: [], y: [] }
		return {
			x: [...slide.x, ...neighbourCandidates.x],
			y: [...slide.y, ...neighbourCandidates.y],
		}
	}

	const getSnapCandidates = (selectionScreenRect, mode) => {
		const slide = getSlideAlignments(selectionScreenRect, mode)
		const neighbour = getNeighbourAlignments(selectionScreenRect, mode)
		return mergeCandidates(slide, neighbour)
	}

	const snapForDrag = (rect) => {
		if (!isSnapping()) return rect

		const selectionScreenRect = toScreenRect(rect)
		const candidates = getSnapCandidates(selectionScreenRect, 'drag')

		const dx = getSnapOffsetForAxis('x', candidates.x, true)
		const dy = getSnapOffsetForAxis('y', candidates.y, true)

		const left = rect.left + dx
		const top = rect.top + dy

		return { ...rect, left, top }
	}

	// apply the offset to the moving edge, the opposite edge stays put
	const applyOffsetToMovingEdges = (rect, dx, dy) => {
		const handle = currentResizer.value || ''
		const snapped = { ...rect }

		if (handle.includes('left')) {
			snapped.left += dx
			snapped.width -= dx
		} else if (handle.includes('right')) {
			snapped.width += dx
		}

		if (handle.includes('top')) {
			snapped.top += dy
			snapped.height -= dy
		} else if (handle.includes('bottom')) {
			snapped.height += dy
		}

		return snapped
	}

	const snapForResize = (rect, { axes = ['x', 'y'] } = {}) => {
		if (!isSnapping()) return rect

		const selectionScreenRect = toScreenRect(rect)
		const candidates = getSnapCandidates(selectionScreenRect, 'resize')

		const dx = getSnapOffsetForAxis('x', candidates.x, axes.includes('x'))
		const dy = getSnapOffsetForAxis('y', candidates.y, axes.includes('y'))

		return applyOffsetToMovingEdges(rect, dx, dy)
	}

	// what SnapGuides draws per axis
	const activeGuides = computed(() => ({ x: activeSnap.x, y: activeSnap.y }))

	return { activeGuides, snapForDrag, snapForResize }
}
