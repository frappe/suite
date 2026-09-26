import type { Point } from './geometry'
import { rectangleCorners } from './rectangle-interactions'
import type { RectangleShape } from './scene'

const ALIGNMENT_SNAP_SCREEN_DISTANCE = 6

export type Axis = 'x' | 'y'

export type Bounds = {
  left: number
  top: number
  right: number
  bottom: number
  centerX: number
  centerY: number
}

export type AlignmentGuide = {
  axis: Axis
  position: number
  start: number
  end: number
}

export type SpacingMarker = {
  axis: Axis
  start: number
  end: number
  cross: number
}

export type ShapeMoveSnap = {
  shape: RectangleShape
  alignmentGuides: AlignmentGuide[]
  spacingMarkers: SpacingMarker[]
}

export type ResizeHandle =
  | 'northwest'
  | 'northeast'
  | 'southeast'
  | 'southwest'
  | 'north'
  | 'east'
  | 'south'
  | 'west'

export type ResizeSnap = {
  point: Point
  alignmentGuides: AlignmentGuide[]
}

type AxisCandidate = {
  delta: number
  guide?: AlignmentGuide
  markers?: SpacingMarker[]
  priority?: number
}

export function snapShapeMove(
  shape: RectangleShape,
  shapes: RectangleShape[],
  scale: number,
): ShapeMoveSnap {
  const references = shapes.filter((candidate) => candidate.id !== shape.id)
  if (references.length === 0) return emptyMoveSnap(shape)

  const bounds = visualBounds(shape)
  const referenceBounds = references.map(visualBounds)
  const tolerance = ALIGNMENT_SNAP_SCREEN_DISTANCE / scale
  const xCandidate = bestAxisCandidate('x', bounds, referenceBounds, tolerance, scale)
  const yCandidate = bestAxisCandidate('y', bounds, referenceBounds, tolerance, scale)
  const nextShape = {
    ...shape,
    x: shape.x + (xCandidate?.delta ?? 0),
    y: shape.y + (yCandidate?.delta ?? 0),
  }

  return {
    shape: nextShape,
    alignmentGuides: [xCandidate?.guide, yCandidate?.guide].filter(isDefined),
    spacingMarkers: [...(xCandidate?.markers ?? []), ...(yCandidate?.markers ?? [])],
  }
}

export function snapResizeHandlePoint(
  point: Point,
  shape: RectangleShape,
  handle: ResizeHandle,
  shapes: RectangleShape[],
  scale: number,
): ResizeSnap {
  const references = shapes.filter((candidate) => candidate.id !== shape.id).map(visualBounds)
  const tolerance = ALIGNMENT_SNAP_SCREEN_DISTANCE / scale
  if (isCornerHandle(handle)) {
    const xCandidate = bestPointAlignment('x', point, references, tolerance)
    const yCandidate = bestPointAlignment('y', point, references, tolerance)
    return {
      point: {
        x: point.x + (xCandidate?.delta ?? 0),
        y: point.y + (yCandidate?.delta ?? 0),
      },
      alignmentGuides: [xCandidate?.guide, yCandidate?.guide].filter(isDefined),
    }
  }

  const angle = ((shape.rotation + (handle === 'north' || handle === 'south' ? 90 : 0)) * Math.PI) / 180
  const normal = { x: Math.cos(angle), y: Math.sin(angle) }
  const candidate = bestEdgeHandleAlignment(point, normal, references, tolerance)
  return {
    point: candidate
      ? { x: point.x + normal.x * candidate.delta, y: point.y + normal.y * candidate.delta }
      : point,
    alignmentGuides: candidate?.guide ? [candidate.guide] : [],
  }
}

export function visualBounds(shape: RectangleShape): Bounds {
  const corners = Object.values(rectangleCorners(shape))
  const left = Math.min(...corners.map((point) => point.x))
  const top = Math.min(...corners.map((point) => point.y))
  const right = Math.max(...corners.map((point) => point.x))
  const bottom = Math.max(...corners.map((point) => point.y))
  return { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 }
}

function bestAxisCandidate(
  axis: Axis,
  active: Bounds,
  references: Bounds[],
  tolerance: number,
  scale: number,
): AxisCandidate | undefined {
  const alignment = bestAlignmentCandidate(axis, active, references, tolerance)
  const spacing = bestSpacingCandidate(axis, active, references, tolerance, scale)
  if (!alignment) return spacing
  if (!spacing) return alignment
  return Math.abs(alignment.delta) <= Math.abs(spacing.delta) ? alignment : spacing
}

function bestAlignmentCandidate(
  axis: Axis,
  active: Bounds,
  references: Bounds[],
  tolerance: number,
): AxisCandidate | undefined {
  const activeAnchors = alignmentAnchors(active, axis)
  let best: AxisCandidate | undefined

  references.forEach((reference) => {
    alignmentAnchors(reference, axis).forEach((referenceAnchor) => {
      activeAnchors.forEach((activeAnchor) => {
        const delta = referenceAnchor.value - activeAnchor.value
        const priority = alignmentPriority(activeAnchor.role, referenceAnchor.role)
        if (Math.abs(delta) > tolerance || !isBetter(delta, best, priority)) return
        best = {
          delta,
          priority,
          guide: alignmentGuide(axis, referenceAnchor.value, active, reference),
        }
      })
    })
  })

  return best
}

function bestPointAlignment(
  axis: Axis,
  point: Point,
  references: Bounds[],
  tolerance: number,
): AxisCandidate | undefined {
  let best: AxisCandidate | undefined
  references.forEach((reference) => {
    alignmentAnchors(reference, axis).forEach((anchor) => {
      const value = axis === 'x' ? point.x : point.y
      const otherValue = axis === 'x' ? point.y : point.x
      const delta = anchor.value - value
      if (Math.abs(delta) > tolerance || !isBetter(delta, best, anchor.role === 'center' ? 0 : 1)) return
      best = {
        delta,
        priority: anchor.role === 'center' ? 0 : 1,
        guide: axis === 'x'
          ? { axis, position: anchor.value, start: Math.min(otherValue, reference.top), end: Math.max(otherValue, reference.bottom) }
          : { axis, position: anchor.value, start: Math.min(otherValue, reference.left), end: Math.max(otherValue, reference.right) },
      }
    })
  })
  return best
}

function bestEdgeHandleAlignment(
  point: Point,
  normal: Point,
  references: Bounds[],
  tolerance: number,
): AxisCandidate | undefined {
  let best: AxisCandidate | undefined
  ;(['x', 'y'] as const).forEach((axis) => {
    const component = normal[axis]
    if (Math.abs(component) < 0.0001) return
    references.forEach((reference) => {
      alignmentAnchors(reference, axis).forEach((anchor) => {
        const travel = (anchor.value - point[axis]) / component
        const priority = anchor.role === 'center' ? 0 : 1
        if (Math.abs(travel) > tolerance || !isBetter(travel, best, priority)) return
        const snappedOther = point[axis === 'x' ? 'y' : 'x'] + normal[axis === 'x' ? 'y' : 'x'] * travel
        best = {
          delta: travel,
          priority,
          guide: axis === 'x'
            ? { axis, position: anchor.value, start: Math.min(snappedOther, reference.top), end: Math.max(snappedOther, reference.bottom) }
            : { axis, position: anchor.value, start: Math.min(snappedOther, reference.left), end: Math.max(snappedOther, reference.right) },
        }
      })
    })
  })
  return best
}

function bestSpacingCandidate(
  axis: Axis,
  active: Bounds,
  references: Bounds[],
  tolerance: number,
  scale: number,
): AxisCandidate | undefined {
  const ordered = [...references].sort((left, right) => minimum(left, axis) - minimum(right, axis))
  let best: AxisCandidate | undefined

  // ponytail: O(n²) is enough for small scenes; add a spatial index only after measured lag.
  for (let firstIndex = 0; firstIndex < ordered.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < ordered.length; secondIndex += 1) {
      const first = ordered[firstIndex]
      const second = ordered[secondIndex]
      if (!first || !second || !sharesLane(active, first, second, axis)) continue

      const pairGap = minimum(second, axis) - maximum(first, axis)
      if (pairGap < 0) continue

      best = chooseSpacingCandidate(
        best,
        trailingSpacingCandidate(axis, active, first, second, pairGap, scale),
        tolerance,
      )
      best = chooseSpacingCandidate(
        best,
        leadingSpacingCandidate(axis, active, first, second, pairGap, scale),
        tolerance,
      )
      best = chooseSpacingCandidate(
        best,
        betweenSpacingCandidate(axis, active, first, second, scale),
        tolerance,
      )
    }
  }

  return best
}

function trailingSpacingCandidate(
  axis: Axis,
  active: Bounds,
  first: Bounds,
  second: Bounds,
  gap: number,
  scale: number,
): AxisCandidate | undefined {
  if (minimum(active, axis) < maximum(second, axis)) return undefined
  const targetMinimum = maximum(second, axis) + gap
  const delta = targetMinimum - minimum(active, axis)
  const cross = markerCross(axis, [first, second, active], scale)
  return {
    delta,
    markers: [
      spacingMarker(axis, maximum(first, axis), minimum(second, axis), cross),
      spacingMarker(axis, maximum(second, axis), minimum(active, axis) + delta, cross),
    ],
  }
}

function leadingSpacingCandidate(
  axis: Axis,
  active: Bounds,
  first: Bounds,
  second: Bounds,
  gap: number,
  scale: number,
): AxisCandidate | undefined {
  if (maximum(active, axis) > minimum(first, axis)) return undefined
  const targetMaximum = minimum(first, axis) - gap
  const delta = targetMaximum - maximum(active, axis)
  const cross = markerCross(axis, [active, first, second], scale)
  return {
    delta,
    markers: [
      spacingMarker(axis, maximum(active, axis) + delta, minimum(first, axis), cross),
      spacingMarker(axis, maximum(first, axis), minimum(second, axis), cross),
    ],
  }
}

function betweenSpacingCandidate(
  axis: Axis,
  active: Bounds,
  first: Bounds,
  second: Bounds,
  scale: number,
): AxisCandidate | undefined {
  if (minimum(active, axis) < maximum(first, axis) || maximum(active, axis) > minimum(second, axis)) {
    return undefined
  }
  const available = minimum(second, axis) - maximum(first, axis) - size(active, axis)
  if (available < 0) return undefined
  const gap = available / 2
  const targetMinimum = maximum(first, axis) + gap
  const delta = targetMinimum - minimum(active, axis)
  const cross = markerCross(axis, [first, active, second], scale)
  return {
    delta,
    markers: [
      spacingMarker(axis, maximum(first, axis), minimum(active, axis) + delta, cross),
      spacingMarker(axis, maximum(active, axis) + delta, minimum(second, axis), cross),
    ],
  }
}

function chooseSpacingCandidate(
  current: AxisCandidate | undefined,
  candidate: AxisCandidate | undefined,
  tolerance: number,
): AxisCandidate | undefined {
  if (!candidate || Math.abs(candidate.delta) > tolerance) return current
  return isBetter(candidate.delta, current) ? candidate : current
}

function alignmentGuide(axis: Axis, position: number, active: Bounds, reference: Bounds): AlignmentGuide {
  return axis === 'x'
    ? { axis, position, start: Math.min(active.top, reference.top), end: Math.max(active.bottom, reference.bottom) }
    : { axis, position, start: Math.min(active.left, reference.left), end: Math.max(active.right, reference.right) }
}

function spacingMarker(axis: Axis, start: number, end: number, cross: number): SpacingMarker {
  return { axis, start, end, cross }
}

function markerCross(axis: Axis, bounds: Bounds[], scale: number): number {
  const offset = 10 / scale
  return axis === 'x'
    ? Math.max(...bounds.map((item) => item.bottom)) + offset
    : Math.max(...bounds.map((item) => item.right)) + offset
}

function sharesLane(active: Bounds, first: Bounds, second: Bounds, axis: Axis): boolean {
  return overlapsOnOtherAxis(active, first, axis) && overlapsOnOtherAxis(active, second, axis)
}

function overlapsOnOtherAxis(first: Bounds, second: Bounds, axis: Axis): boolean {
  return axis === 'x'
    ? Math.min(first.bottom, second.bottom) >= Math.max(first.top, second.top)
    : Math.min(first.right, second.right) >= Math.max(first.left, second.left)
}

function alignmentAnchors(
  bounds: Bounds,
  axis: Axis,
): Array<{ value: number; role: 'edge' | 'center' }> {
  return axis === 'x'
    ? [
        { value: bounds.left, role: 'edge' },
        { value: bounds.centerX, role: 'center' },
        { value: bounds.right, role: 'edge' },
      ]
    : [
        { value: bounds.top, role: 'edge' },
        { value: bounds.centerY, role: 'center' },
        { value: bounds.bottom, role: 'edge' },
      ]
}

function minimum(bounds: Bounds, axis: Axis): number {
  return axis === 'x' ? bounds.left : bounds.top
}

function maximum(bounds: Bounds, axis: Axis): number {
  return axis === 'x' ? bounds.right : bounds.bottom
}

function size(bounds: Bounds, axis: Axis): number {
  return maximum(bounds, axis) - minimum(bounds, axis)
}

function isBetter(delta: number, current: AxisCandidate | undefined, priority = 0): boolean {
  if (!current) return true
  const distance = Math.abs(delta)
  const currentDistance = Math.abs(current.delta)
  return distance < currentDistance || (distance === currentDistance && priority < (current.priority ?? 0))
}

function alignmentPriority(activeRole: 'edge' | 'center', referenceRole: 'edge' | 'center'): number {
  if (activeRole === 'center' && referenceRole === 'center') return 0
  if (activeRole === referenceRole) return 1
  return 2
}

function isCornerHandle(handle: ResizeHandle): boolean {
  return handle === 'northwest' || handle === 'northeast' || handle === 'southeast' || handle === 'southwest'
}

function emptyMoveSnap(shape: RectangleShape): ShapeMoveSnap {
  return { shape, alignmentGuides: [], spacingMarkers: [] }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
