import type { Point } from './geometry'
import { constrainRotationAngle, normalizeAngle } from './rotation'
import type { LineShape } from './scene'

export type LineEndpoint = 'start' | 'end'
export type LineHandle = LineEndpoint | 'curve'

export function moveLine(line: LineShape, delta: Point): LineShape {
  return {
    ...line,
    start: { x: line.start.x + delta.x, y: line.start.y + delta.y },
    end: { x: line.end.x + delta.x, y: line.end.y + delta.y },
    curve: typeof line.curve === 'object' ? { x: line.curve.x + delta.x, y: line.curve.y + delta.y } : line.curve,
  }
}

export function setLineCurve(line: LineShape, pointer: Point): LineShape {
  return { ...line, curve: { ...pointer } }
}

export function rotateLineEndpoint(line: LineShape, endpoint: LineEndpoint, pointer: Point, constrainAngle = false): LineShape {
  const anchor = endpoint === 'start' ? line.end : line.start
  const offset = { x: pointer.x - anchor.x, y: pointer.y - anchor.y }
  const length = Math.hypot(offset.x, offset.y)
  if (length === 0) return { ...line, [endpoint]: { ...pointer } }

  const rawAngle = (Math.atan2(offset.y, offset.x) * 180) / Math.PI
  const angle = constrainAngle ? constrainRotationAngle(rawAngle, 45) : normalizeAngle(rawAngle)
  if (angle === normalizeAngle(rawAngle)) return { ...line, [endpoint]: { ...pointer } }

  const radians = (angle * Math.PI) / 180
  const snappedPoint = {
    x: anchor.x + length * Math.cos(radians),
    y: anchor.y + length * Math.sin(radians),
  }
  return { ...line, [endpoint]: snappedPoint }
}
