import type { Point } from './geometry'
import { lineControlPoint, linePointAt, type LineShape } from './scene'

export type ArrowGeometry = {
  path: string
  gradientStart: Point
  gradientEnd: Point
}

const samples = 32

export function arrowGeometry(line: LineShape, viewportScale = 1): ArrowGeometry {
  const centerline = Array.from({ length: samples + 1 }, (_, index) =>
    linePointAt(line, index / samples),
  )
  const length = centerline
    .slice(1)
    .reduce((total, point, index) => total + distance(centerline[index]!, point), 0)
  const weight = (line.strokeWidth ?? 2) / Math.max(viewportScale, 0.01)
  const headLength = Math.min(weight * 4, length * 0.55)
  const shaftHalfWidth = weight / 2
  const headHalfWidth = Math.max(shaftHalfWidth, Math.min(weight * 2.2, length * 0.3))
  let headStartT = 0
  let remaining = headLength

  for (let index = samples; index > 0; index--) {
    const segmentLength = distance(centerline[index]!, centerline[index - 1]!)
    if (remaining <= segmentLength) {
      headStartT = (index - remaining / segmentLength) / samples
      break
    }
    remaining -= segmentLength
  }

  const base = linePointAt(line, headStartT)
  const axis = normalize({ x: line.end.x - base.x, y: line.end.y - base.y })
  if (!length || !axis) return { path: '', gradientStart: base, gradientEnd: line.end }
  const normal = { x: -axis.y, y: axis.x }
  const shaftSteps = Math.max(8, Math.ceil(samples * headStartT))
  const upper = offsetCurve(line, headStartT, shaftSteps, shaftHalfWidth, axis)
  const lower = offsetCurve(line, headStartT, shaftSteps, -shaftHalfWidth, axis)
  upper[upper.length - 1] = add(base, normal, shaftHalfWidth)
  lower[lower.length - 1] = add(base, normal, -shaftHalfWidth)
  lower.reverse()
  const barbUpper = add(base, axis, headLength * 0.18, normal, headHalfWidth)
  const shoulderUpper = add(base, axis, headLength * 0.64, normal, headHalfWidth * 0.72)
  const shoulderLower = add(base, axis, headLength * 0.64, normal, -headHalfWidth * 0.72)
  const barbLower = add(base, axis, headLength * 0.18, normal, -headHalfWidth)
  const path = [
    `M ${point(upper[0]!)}`,
    curveCommands(upper),
    `Q ${point(add(base, axis, headLength * 0.04, normal, headHalfWidth * 0.72))} ${point(barbUpper)}`,
    `Q ${point(add(base, axis, headLength * 0.43, normal, headHalfWidth * 1.12))} ${point(shoulderUpper)}`,
    `Q ${point(add(base, axis, headLength * 0.9, normal, headHalfWidth * 0.52))} ${point(line.end)}`,
    `Q ${point(add(base, axis, headLength * 0.9, normal, -headHalfWidth * 0.52))} ${point(shoulderLower)}`,
    `Q ${point(add(base, axis, headLength * 0.43, normal, -headHalfWidth * 1.12))} ${point(barbLower)}`,
    `Q ${point(add(base, axis, headLength * 0.04, normal, -headHalfWidth * 0.72))} ${point(add(base, normal, -shaftHalfWidth))}`,
    curveCommands(lower),
    'Z',
  ].join(' ')
  const extent = length + headLength + headHalfWidth
  return {
    path,
    gradientStart: add(base, axis, -extent),
    gradientEnd: add(base, axis, extent),
  }
}

function offsetCurve(
  line: LineShape,
  endT: number,
  count: number,
  offset: number,
  fallback: Point,
): Point[] {
  const control = lineControlPoint(line)
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = (endT * index) / count
    const tangent =
      normalize({
        x: 2 * (1 - t) * (control.x - line.start.x) + 2 * t * (line.end.x - control.x),
        y: 2 * (1 - t) * (control.y - line.start.y) + 2 * t * (line.end.y - control.y),
      }) ?? fallback
    const center = linePointAt(line, t)
    return { x: center.x - tangent.y * offset, y: center.y + tangent.x * offset }
  })
}

function curveCommands(points: Point[]): string {
  let path = ''
  for (let index = 1; index < points.length - 1; index++) {
    const current = points[index]!,
      next = points[index + 1]!
    path += ` Q ${point(current)} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`
  }
  const last = points.at(-1)!
  return `${path} L ${point(last)}`
}

function add(origin: Point, axis: Point, along: number, normal?: Point, across = 0): Point {
  return {
    x: origin.x + axis.x * along + (normal?.x ?? 0) * across,
    y: origin.y + axis.y * along + (normal?.y ?? 0) * across,
  }
}

function normalize(vector: Point): Point | undefined {
  const length = Math.hypot(vector.x, vector.y)
  return length ? { x: vector.x / length, y: vector.y / length } : undefined
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function point(value: Point): string {
  return `${value.x} ${value.y}`
}
