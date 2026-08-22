import { generateUniqueId, normalizeRotation } from './helpers'
import { getRotatedVector } from './resize'
import { getPolygonVertices, isPolygonShape } from './shapeGeometry'

export const SIDES = ['top', 'right', 'bottom', 'left']

// outward direction of each side in the box's own (unrotated) frame
const SIDE_NORMAL = {
	top: { x: 0, y: -1 },
	right: { x: 1, y: 0 },
	bottom: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
}

// hysteresis around the diagonals so a target sliding along one doesn't flip sides
const SIDE_HYSTERESIS_DEGREES = 2

const addVectors = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
const subtractVectors = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })

export const getBoxCenter = (box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })

// box-local (top-left relative) point to slide space, rotated about the centre
const toSlideSpace = (box, localPoint) => {
	const center = getBoxCenter(box)
	const fromCenter = { x: localPoint.x - box.width / 2, y: localPoint.y - box.height / 2 }
	return addVectors(center, getRotatedVector(fromCenter, box.rotation || 0))
}

// slide-space point to box-local, unrotated
const toLocalSpace = (box, point) => {
	const fromCenter = getRotatedVector(subtractVectors(point, getBoxCenter(box)), -(box.rotation || 0))
	return { x: fromCenter.x + box.width / 2, y: fromCenter.y + box.height / 2 }
}

export const containsPoint = (box, point) => {
	const local = toLocalSpace(box, point)
	return local.x >= 0 && local.x <= box.width && local.y >= 0 && local.y <= box.height
}

// side whose port lies within `radius` of `point`, nearest first
export const snapToPort = (box, point, radius) => {
	let nearest = null
	let best = radius
	SIDES.forEach((side) => {
		const port = getPort(box, side)
		const distance = Math.hypot(point.x - port.x, point.y - port.y)
		if (distance >= best) return
		best = distance
		nearest = side
	})
	return nearest
}

// midpoint of a side of the (rotated) bounding box
export const getAnchorPoint = (box, side) => {
	const normal = SIDE_NORMAL[side]
	return toSlideSpace(box, {
		x: box.width / 2 + (normal.x * box.width) / 2,
		y: box.height / 2 + (normal.y * box.height) / 2,
	})
}

// closed local-space outline; ovals are analytic and return nothing
const getLocalOutline = (box) => {
	const { width, height, shapeType } = box
	if (isPolygonShape(shapeType)) return getPolygonVertices(shapeType, width, height)
	return [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
	]
}

// distance along the ray (origin + t·direction) at which it crosses the segment a→b
const raySegmentDistance = (origin, direction, a, b) => {
	const edge = subtractVectors(b, a)
	const denominator = direction.x * edge.y - direction.y * edge.x
	if (Math.abs(denominator) < 1e-9) return null

	const toA = subtractVectors(a, origin)
	const t = (toA.x * edge.y - toA.y * edge.x) / denominator
	const u = (toA.x * direction.y - toA.y * direction.x) / denominator
	if (t < 0 || u < -1e-9 || u > 1 + 1e-9) return null
	return t
}

// where the centre→target ray leaves the outline; the centre when target sits on it
export const clipToBoundary = (box, target) => {
	const center = { x: box.width / 2, y: box.height / 2 }
	const direction = subtractVectors(toLocalSpace(box, target), center)
	if (!direction.x && !direction.y) return getBoxCenter(box)

	let distance
	if (box.shapeType === 'oval') {
		const a = box.width / 2
		const b = box.height / 2
		distance = 1 / Math.hypot(direction.x / a, direction.y / b)
	} else {
		const outline = getLocalOutline(box)
		const crossings = outline
			.map((vertex, i) => raySegmentDistance(center, direction, vertex, outline[(i + 1) % outline.length]))
			.filter((t) => t !== null)
		distance = crossings.length ? Math.max(...crossings) : 0
	}

	return toSlideSpace(box, {
		x: center.x + direction.x * distance,
		y: center.y + direction.y * distance,
	})
}

// fixed-side port: where the centre→side-midpoint ray leaves the outline
export const getPort = (box, side) => clipToBoundary(box, getAnchorPoint(box, side))

const SIDE_ANGLE = { right: 0, bottom: 90, left: 180, top: -90 }

const angleDifference = (a, b) => {
	const diff = ((((a - b) % 360) + 540) % 360) - 180
	return Math.abs(diff)
}

// side facing `target`, judged as if square; keeps `previousSide` inside the hysteresis band
export const resolveAutoSide = (box, target, previousSide = null) => {
	const local = toLocalSpace(box, target)
	const direction = { x: local.x - box.width / 2, y: local.y - box.height / 2 }
	if (!direction.x && !direction.y) return previousSide ?? 'right'

	const normalized = { x: direction.x / (box.width || 1), y: direction.y / (box.height || 1) }
	const angle = (Math.atan2(normalized.y, normalized.x) * 180) / Math.PI

	if (previousSide && angleDifference(angle, SIDE_ANGLE[previousSide]) <= 45 + SIDE_HYSTERESIS_DEGREES) {
		return previousSide
	}
	return SIDES.reduce((best, side) =>
		angleDifference(angle, SIDE_ANGLE[side]) < angleDifference(angle, SIDE_ANGLE[best]) ? side : best,
	)
}

// a line's centre runs at top + strokeWidth / 2 whatever the stored height
export const getLineEndpoints = (line) => {
	const center = { x: line.left + line.width / 2, y: line.top + line.strokeWidth / 2 }
	const halfSpan = getRotatedVector({ x: line.width / 2, y: 0 }, line.rotation || 0)
	return { start: subtractVectors(center, halfSpan), end: addVectors(center, halfSpan) }
}

export const getLineBox = (start, end, strokeWidth) => {
	const span = subtractVectors(end, start)
	const length = Math.hypot(span.x, span.y)
	return {
		width: length,
		height: strokeWidth,
		left: (start.x + end.x) / 2 - length / 2,
		top: (start.y + end.y) / 2 - strokeWidth / 2,
		rotation: normalizeRotation((Math.atan2(span.y, span.x) * 180) / Math.PI),
	}
}

// last side each auto end settled on, so the hysteresis has something to hold
const lastAutoSide = new Map()

// `auto` takes the port of the side facing the other end's target
const resolveSide = (key, box, anchor, aim) => {
	if (anchor !== 'auto') return anchor
	const side = resolveAutoSide(box, aim, lastAutoSide.get(key))
	lastAutoSide.set(key, side)
	return side
}

const resolveEnd = (key, box, anchor, aim) => getPort(box, resolveSide(key, box, anchor, aim))

// straight geometry on `startBox` / `endBox`; a null (free) end stays put
export const routeConnector = (line, startBox, endBox) => {
	if (line.connector?.route === 'elbow') return routeElbow(line, startBox, endBox)
	const free = getConnectorEndpoints(line)
	const startAim = endBox ? getBoxCenter(endBox) : free.end
	const endAim = startBox ? getBoxCenter(startBox) : free.start
	const start = startBox
		? resolveEnd(`${line.id}:start`, startBox, line.connector.start.anchor, startAim)
		: free.start
	const end = endBox
		? resolveEnd(`${line.id}:end`, endBox, line.connector.end.anchor, endAim)
		: free.end
	return getLineBox(start, end, line.strokeWidth)
}

const ELBOW_STUB = 24

// free ends of a line, elbow or straight
export const getConnectorEndpoints = (line) => {
	if (!line.points) return getLineEndpoints(line)
	const toSlide = (point) => ({ x: line.left + point.x, y: line.top + point.y })
	return { start: toSlide(line.points[0]), end: toSlide(line.points.at(-1)) }
}

// axis-aligned unit vector nearest to `vector`
const snapToAxis = (vector) =>
	Math.abs(vector.x) >= Math.abs(vector.y)
		? { x: Math.sign(vector.x) || 1, y: 0 }
		: { x: 0, y: Math.sign(vector.y) || 1 }

// unrotated bounds enclosing a rotated box
const getEnclosingBounds = (box) => {
	const corners = [
		{ x: 0, y: 0 },
		{ x: box.width, y: 0 },
		{ x: box.width, y: box.height },
		{ x: 0, y: box.height },
	].map((corner) => toSlideSpace(box, corner))
	const xs = corners.map((corner) => corner.x)
	const ys = corners.map((corner) => corner.y)
	return {
		left: Math.min(...xs),
		top: Math.min(...ys),
		right: Math.max(...xs),
		bottom: Math.max(...ys),
	}
}

// separation between two bounds along each axis, negative when they overlap
const getGap = (a, b) => ({
	x: Math.max(b.left - a.right, a.left - b.right),
	y: Math.max(b.top - a.bottom, a.top - b.bottom),
})

// an axis-aligned segment crosses the interior of `bounds` (touching the edge is fine)
const crossesBounds = (a, b, bounds) => {
	const epsilon = 0.5
	const left = Math.min(a.x, b.x)
	const right = Math.max(a.x, b.x)
	const top = Math.min(a.y, b.y)
	const bottom = Math.max(a.y, b.y)
	return (
		right > bounds.left + epsilon &&
		left < bounds.right - epsilon &&
		bottom > bounds.top + epsilon &&
		top < bounds.bottom - epsilon
	)
}

// a path that turns 180° retraces itself
const doublesBack = (points) =>
	points.some((point, i) => {
		if (i < 2) return false
		const previous = subtractVectors(points[i - 1], points[i - 2])
		const current = subtractVectors(point, points[i - 1])
		return previous.x * current.x + previous.y * current.y < 0
	})

const isSamePoint = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6

// drops repeated points and the middle of every straight run
const simplifyPath = (points) => {
	const path = []
	points.forEach((point) => {
		if (path.length && isSamePoint(path.at(-1), point)) return
		if (path.length >= 2) {
			const [a, b] = path.slice(-2)
			const collinear = (a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)
			if (collinear) path.pop()
		}
		path.push(point)
	})
	return path
}

const getPathLength = (path) =>
	path.reduce(
		(sum, point, i) =>
			i ? sum + Math.abs(point.x - path[i - 1].x) + Math.abs(point.y - path[i - 1].y) : 0,
		0,
	)

// stub → mid-line → stub over candidate lines; fewest bends, then shortest, clearing both boxes
export const getElbowPath = ({ start, end, startNormal, endNormal, startBounds, endBounds }) => {
	const delta = subtractVectors(end, start)
	startNormal = startNormal ? snapToAxis(startNormal) : snapToAxis(delta)
	endNormal = endNormal ? snapToAxis(endNormal) : snapToAxis({ x: -delta.x, y: -delta.y })

	// stubs shrink per axis when the boxes sit closer than two of them
	const room = (gap) => (gap > 0 ? Math.min(ELBOW_STUB, gap / 2) : ELBOW_STUB)
	let stub
	if (startBounds && endBounds) {
		const gap = getGap(startBounds, endBounds)
		if (gap.x <= 0 && gap.y <= 0) return [start, end]
		stub = { x: room(gap.x), y: room(gap.y) }
	} else {
		stub = { x: room(Math.abs(delta.x)), y: room(Math.abs(delta.y)) }
	}

	const startStub = { x: start.x + startNormal.x * stub.x, y: start.y + startNormal.y * stub.y }
	const endStub = { x: end.x + endNormal.x * stub.x, y: end.y + endNormal.y * stub.y }

	const bounds = [startBounds, endBounds].filter(Boolean)
	const union = {
		left: Math.min(startStub.x, endStub.x, ...bounds.map((b) => b.left)),
		top: Math.min(startStub.y, endStub.y, ...bounds.map((b) => b.top)),
		right: Math.max(startStub.x, endStub.x, ...bounds.map((b) => b.right)),
		bottom: Math.max(startStub.y, endStub.y, ...bounds.map((b) => b.bottom)),
	}
	const clearance = bounds.map((b) => ({
		left: b.left - stub.x,
		top: b.top - stub.y,
		right: b.right + stub.x,
		bottom: b.bottom + stub.y,
	}))

	const verticals = [
		(startStub.x + endStub.x) / 2,
		startStub.x,
		endStub.x,
		union.left - stub.x,
		union.right + stub.x,
	]
	const horizontals = [
		(startStub.y + endStub.y) / 2,
		startStub.y,
		endStub.y,
		union.top - stub.y,
		union.bottom + stub.y,
	]
	const candidates = [
		...verticals.map((x) => [
			{ x, y: startStub.y },
			{ x, y: endStub.y },
		]),
		...horizontals.map((y) => [
			{ x: startStub.x, y },
			{ x: endStub.x, y },
		]),
	]

	let best = null
	candidates.forEach((middle) => {
		const raw = [start, startStub, ...middle, endStub, end]
		if (doublesBack(raw)) return
		// the stubs sit inside the clearance band by design, so only the run between them is judged
		const blocked = raw
			.slice(1, -2)
			.some((point, i) => clearance.some((c) => crossesBounds(point, raw[i + 2], c)))
		if (blocked) return
		const path = simplifyPath(raw)
		const score = [path.length, getPathLength(path)]
		if (
			!best ||
			score[0] < best.score[0] ||
			(score[0] === best.score[0] && score[1] < best.score[1])
		) {
			best = { path, score }
		}
	})
	return best ? best.path : simplifyPath([start, startStub, endStub, end])
}

// unrotated box around the route, points relative to its corner
export const routeElbow = (line, startBox, endBox) => {
	const free = getConnectorEndpoints(line)
	const startAim = endBox ? getBoxCenter(endBox) : free.end
	const endAim = startBox ? getBoxCenter(startBox) : free.start
	const startSide =
		startBox && resolveSide(`${line.id}:start`, startBox, line.connector.start.anchor, startAim)
	const endSide = endBox && resolveSide(`${line.id}:end`, endBox, line.connector.end.anchor, endAim)
	const outward = (box, side) => getRotatedVector(SIDE_NORMAL[side], box.rotation || 0)

	const path = getElbowPath({
		start: startBox ? getPort(startBox, startSide) : free.start,
		end: endBox ? getPort(endBox, endSide) : free.end,
		startNormal: startBox ? outward(startBox, startSide) : null,
		endNormal: endBox ? outward(endBox, endSide) : null,
		startBounds: startBox ? getEnclosingBounds(startBox) : null,
		endBounds: endBox ? getEnclosingBounds(endBox) : null,
	})

	const left = Math.min(...path.map((point) => point.x))
	const top = Math.min(...path.map((point) => point.y))
	return {
		left,
		top,
		width: Math.max(...path.map((point) => point.x)) - left,
		height: Math.max(...path.map((point) => point.y)) - top,
		rotation: 0,
		points: path.map((point) => ({ x: point.x - left, y: point.y - top })),
	}
}

const ELBOW_CORNER_RADIUS = 8

// pulls `point` toward `toward` by `distance`, never past the midpoint
const pullAlong = (point, toward, distance) => {
	const span = subtractVectors(toward, point)
	const length = Math.hypot(span.x, span.y)
	if (!length) return point
	const t = Math.min(distance, length / 2) / length
	return { x: point.x + span.x * t, y: point.y + span.y * t }
}

// rounded-corner path, ends pulled back by the marker insets
export const getElbowPathData = (points, startInset = 0, endInset = 0) => {
	if (points.length < 2) return ''
	const path = [...points]
	path[0] = pullAlong(path[0], path[1], startInset)
	path[path.length - 1] = pullAlong(path.at(-1), path.at(-2), endInset)

	const commands = [`M ${path[0].x} ${path[0].y}`]
	for (let i = 1; i < path.length - 1; i++) {
		const corner = path[i]
		const before = pullAlong(corner, path[i - 1], ELBOW_CORNER_RADIUS)
		const after = pullAlong(corner, path[i + 1], ELBOW_CORNER_RADIUS)
		commands.push(`L ${before.x} ${before.y}`, `Q ${corner.x} ${corner.y} ${after.x} ${after.y}`)
	}
	commands.push(`L ${path.at(-1).x} ${path.at(-1).y}`)
	return commands.join(' ')
}

export const getBoundTargetIds = (connector) =>
	[connector?.start, connector?.end].filter(Boolean).map((end) => end.elementId)

// a bound end that a gesture carries off its port lets go of its target
export const detachMovedEnds = (line, box) => {
	const before = getConnectorEndpoints(line)
	const after = getConnectorEndpoints({ ...line, ...box })
	const connector = { ...line.connector }
	let detached = false
	;['start', 'end'].forEach((end) => {
		if (!connector[end]) return
		if (Math.hypot(after[end].x - before[end].x, after[end].y - before[end].y) < 0.5) return
		connector[end] = null
		detached = true
	})
	return detached ? connector : null
}

// fresh ids for a copied set; bindings inside it follow the copies, the rest drop
export const remapElementIds = (elements) => {
	const newIds = elements.map(() => generateUniqueId())
	const idMap = new Map(elements.map((element, i) => [element.id, newIds[i]]))
	elements.forEach((element, i) => {
		element.id = newIds[i]
		if (!element.connector) return
		;['start', 'end'].forEach((end) => {
			const bound = element.connector[end]
			if (!bound) return
			const elementId = idMap.get(bound.elementId)
			element.connector[end] = elementId ? { ...bound, elementId } : null
		})
	})
	return elements
}
