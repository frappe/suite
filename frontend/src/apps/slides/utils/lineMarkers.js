export const MARKER_STYLES = ['none', 'arrow', 'triangle', 'circle', 'diamond']

// older lines stored booleans, where true meant the filled triangle
export const normalizeMarker = (value) => {
	if (value === true) return 'triangle'
	if (typeof value === 'string' && value !== 'none') return value
	return null
}

// heads grow with the stroke but never vanish on thin lines
export const getMarkerSize = (strokeWidth) => 8 + strokeWidth * 2.5

// vertex at the origin pointing +x, tip at x = inset; the line pulls back by inset
export const getMarkerShape = (style, strokeWidth) => {
	const size = getMarkerSize(strokeWidth)
	switch (style) {
		case 'triangle': {
			const h = size * 0.8
			return { d: `M0,${-h / 2} L${size},0 L0,${h / 2} Z`, filled: true, inset: size }
		}
		case 'arrow': {
			const h = size * 0.8
			return { d: `M${-size},${-h / 2} L0,0 L${-size},${h / 2}`, filled: false, inset: 0 }
		}
		case 'circle': {
			const r = size * 0.35
			return {
				d: `M${-r},0 a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`,
				filled: true,
				inset: r,
			}
		}
		case 'diamond': {
			const r = size * 0.45
			return { d: `M${-r},0 L0,${-r} L${r},0 L0,${r} Z`, filled: true, inset: r }
		}
		default:
			return null
	}
}
