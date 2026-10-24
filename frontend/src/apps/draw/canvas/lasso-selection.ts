import type { Point } from './geometry'
import {
  containsPoint,
  rectangleCenter,
  rectangleCorners,
  rotatePoint,
} from './rectangle-interactions'
import { isClosedFreeDraw, linePointAt, type DiamondShape } from './scene'
import { isFreeDraw, isLine, type Shape } from './selection'

const LINE_SAMPLES = 32
const ELLIPSE_SAMPLES = 32
const DIAMOND_CORNER_SAMPLES = 8

export type LassoOperation = 'replace' | 'add' | 'subtract'

export function applyLassoSelection(
  currentIds: string[],
  lassoIds: string[],
  operation: LassoOperation,
): string[] {
  const selected = new Set(operation === 'replace' ? [] : currentIds)
  for (const id of lassoIds) {
    if (operation === 'subtract') selected.delete(id)
    else selected.add(id)
  }
  return [...selected]
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous]!
    const end = polygon[index]!
    if (pointOnSegment(point, start, end)) return true
    if (
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    ) {
      inside = !inside
    }
  }
  return inside
}

export function shapesIntersectingLasso(shapes: Shape[], polygon: Point[]): Shape[] {
  if (polygon.length < 3) return []
  return shapes.filter((shape) => shapeIntersectsPolygon(shape, polygon))
}

function shapeIntersectsPolygon(shape: Shape, polygon: Point[]): boolean {
  const boundary = shapeBoundary(shape)
  if (boundary.some((point) => pointInPolygon(point, polygon))) return true
  if (polygon.some((point) => shapeContainsPoint(shape, point))) return true

  const shapeEdges = edges(
    boundary,
    !isLine(shape) && (!isFreeDraw(shape) || isClosedFreeDraw(shape)),
  )
  const polygonEdges = edges(polygon, true)
  return shapeEdges.some(([start, end]) =>
    polygonEdges.some(([otherStart, otherEnd]) =>
      segmentsIntersect(start, end, otherStart, otherEnd),
    ),
  )
}

function shapeBoundary(shape: Shape): Point[] {
  if (isLine(shape))
    return Array.from({ length: LINE_SAMPLES + 1 }, (_, index) =>
      linePointAt(shape, index / LINE_SAMPLES),
    )
  if (isFreeDraw(shape)) return shape.points
  if ((shape as { kind?: string }).kind === 'ellipse') {
    const center = rectangleCenter(shape)
    return Array.from({ length: ELLIPSE_SAMPLES }, (_, index) => {
      const angle = (index * Math.PI * 2) / ELLIPSE_SAMPLES
      return rotatePoint(
        {
          x: center.x + (Math.cos(angle) * shape.width) / 2,
          y: center.y + (Math.sin(angle) * shape.height) / 2,
        },
        center,
        shape.rotation,
      )
    })
  }
  if (isDiamond(shape)) return diamondBoundary(shape)
  return Object.values(rectangleCorners(shape))
}

function shapeContainsPoint(shape: Shape, point: Point): boolean {
  if (isLine(shape)) return false
  if (isFreeDraw(shape)) return isClosedFreeDraw(shape) && pointInPolygon(point, shape.points)
  if (isDiamond(shape)) return pointInPolygon(point, diamondBoundary(shape))
  return containsPoint(shape, point)
}

function isDiamond(shape: Shape): shape is DiamondShape {
  return (shape as { kind?: string }).kind === 'diamond'
}

function diamondBoundary(shape: DiamondShape): Point[] {
  const center = rectangleCenter(shape)
  const vertices = [
    { x: center.x, y: shape.y },
    { x: shape.x + shape.width, y: center.y },
    { x: center.x, y: shape.y + shape.height },
    { x: shape.x, y: center.y },
  ]
  const edgeLength = Math.hypot(shape.width / 2, shape.height / 2)
  if (!edgeLength) return [center]

  const offset = Math.min(Math.max(0, shape.cornerRadius), edgeLength / 2) / edgeLength
  const corners = vertices.map((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length]!
    const next = vertices[(index + 1) % vertices.length]!
    return {
      vertex,
      entry: {
        x: vertex.x + (previous.x - vertex.x) * offset,
        y: vertex.y + (previous.y - vertex.y) * offset,
      },
      exit: {
        x: vertex.x + (next.x - vertex.x) * offset,
        y: vertex.y + (next.y - vertex.y) * offset,
      },
    }
  })
  const boundary = [corners[0]!.entry]
  for (let index = 0; index < corners.length; index++) {
    const corner = corners[index]!
    const next = corners[(index + 1) % corners.length]!
    for (let sample = 1; sample <= DIAMOND_CORNER_SAMPLES; sample++) {
      const progress = sample / DIAMOND_CORNER_SAMPLES
      const inverse = 1 - progress
      boundary.push({
        x:
          inverse ** 2 * corner.entry.x +
          2 * inverse * progress * corner.vertex.x +
          progress ** 2 * corner.exit.x,
        y:
          inverse ** 2 * corner.entry.y +
          2 * inverse * progress * corner.vertex.y +
          progress ** 2 * corner.exit.y,
      })
    }
    boundary.push(next.entry)
  }
  return boundary.map((point) => rotatePoint(point, center, shape.rotation))
}

function edges(points: Point[], closed: boolean): [Point, Point][] {
  const count = closed ? points.length : points.length - 1
  return Array.from(
    { length: Math.max(0, count) },
    (_, index) => [points[index]!, points[(index + 1) % points.length]!] as [Point, Point],
  )
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  if (abC * abD < 0 && cdA * cdB < 0) return true
  return (
    (abC === 0 && pointOnSegment(c, a, b)) ||
    (abD === 0 && pointOnSegment(d, a, b)) ||
    (cdA === 0 && pointOnSegment(a, c, d)) ||
    (cdB === 0 && pointOnSegment(b, c, d))
  )
}

function orientation(a: Point, b: Point, c: Point): number {
  const first = (b.x - a.x) * (c.y - a.y)
  const second = (b.y - a.y) * (c.x - a.x)
  const cross = first - second
  const tolerance = (Math.abs(first) + Math.abs(second) + 1) * Number.EPSILON * 8
  return Math.abs(cross) <= tolerance ? 0 : Math.sign(cross)
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  if (orientation(start, end, point) !== 0) return false
  const tolerance =
    Number.EPSILON *
    Math.max(1, Math.abs(start.x), Math.abs(start.y), Math.abs(end.x), Math.abs(end.y)) *
    8
  return (
    point.x >= Math.min(start.x, end.x) - tolerance &&
    point.x <= Math.max(start.x, end.x) + tolerance &&
    point.y >= Math.min(start.y, end.y) - tolerance &&
    point.y <= Math.max(start.y, end.y) + tolerance
  )
}
