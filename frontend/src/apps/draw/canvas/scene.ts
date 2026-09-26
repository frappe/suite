import type { Point } from './geometry'

export type RectangleShape = {
  id: string
  groupId?: string
  order?: number
  x: number
  y: number
  width: number
  height: number
  rotation: number
  cornerRadius: number
  label?: string
  labelFontSize?: number
  labelFontFamily?: TextFontFamily
  labelFill?: string
  labelFontWeight?: TextFontWeight
  labelFontStyle?: 'normal' | 'italic'
  labelTextDecoration?: 'none' | 'underline' | 'line-through'
  labelTextAlign?: TextAlign
  stroke?: string | null
  fill?: string
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  opacity?: number
  link?: string
}

export type EllipseShape = RectangleShape & {
  kind: 'ellipse'
}

export type DiamondShape = RectangleShape & {
  kind: 'diamond'
}

export type LineShape = {
  id: string
  groupId?: string
  order?: number
  kind: 'line' | 'arrow'
  start: Point
  end: Point
  curve?: Point | number
  stroke?: string | null
  arrowHeadFill?: string
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  opacity?: number
  link?: string
}

export type TextShape = RectangleShape & {
  kind: 'text'
  text: string
  backgroundColor?: string
  fontSize: number
  wrap: boolean
  fontFamily?: TextFontFamily
  fontWeight?: TextFontWeight
  fontStyle?: 'normal' | 'italic'
  textDecoration?: 'none' | 'underline' | 'line-through'
  textAlign?: TextAlign
}

export type TextFontFamily = 'shantell' | 'inter' | 'georgia' | 'mono'
export type TextFontWeight = 400 | 500 | 600 | 700
export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export type ImageShape = RectangleShape & {
  kind: 'image'
  src: string
  naturalWidth?: number
  naturalHeight?: number
  crop?: { x: number; y: number; width: number; height: number }
}

export type FreeDrawShape = RectangleShape & {
  kind: 'freedraw'
  points: Point[]
  pressures: number[]
  simulatePressure: boolean
}

export function isClosedFreeDraw(shape: FreeDrawShape): boolean {
  const first = shape.points[0]
  const last = shape.points.at(-1)
  return Boolean(shape.points.length > 2 && first && last && first.x === last.x && first.y === last.y)
}

export function freeDrawPath(shape: FreeDrawShape): string {
  if (!shape.points.length) return ''
  if (shape.points.length === 1) return `M ${shape.points[0]!.x} ${shape.points[0]!.y} l .01 0`
  let path = `M ${shape.points[0]!.x} ${shape.points[0]!.y}`
  for (let index = 1; index < shape.points.length - 1; index++) {
    const point = shape.points[index]!, next = shape.points[index + 1]!
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
  }
  const last = shape.points.at(-1)!
  return isClosedFreeDraw(shape) ? `${path} Z` : `${path} L ${last.x} ${last.y}`
}

export function rectangleFromPoints(
  start: Point,
  end: Point,
  id: string,
  constrainProportions = false,
): RectangleShape {
  const constrainedEnd = constrainProportions ? squareEndPoint(start, end) : end
  return {
    id,
    x: Math.min(start.x, constrainedEnd.x),
    y: Math.min(start.y, constrainedEnd.y),
    width: Math.abs(constrainedEnd.x - start.x),
    height: Math.abs(constrainedEnd.y - start.y),
    rotation: 0,
    cornerRadius: 8,
  }
}

export function ellipseFromPoints(
  start: Point,
  end: Point,
  id: string,
  constrainProportions = false,
): EllipseShape {
  return { ...rectangleFromPoints(start, end, id, constrainProportions), kind: 'ellipse' }
}

export function diamondFromPoints(
  start: Point,
  end: Point,
  id: string,
  constrainProportions = false,
): DiamondShape {
  return { ...rectangleFromPoints(start, end, id, constrainProportions), kind: 'diamond' }
}

export function diamondPath(shape: RectangleShape): string {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }
  const vertices = [
    { x: center.x, y: shape.y },
    { x: shape.x + shape.width, y: center.y },
    { x: center.x, y: shape.y + shape.height },
    { x: shape.x, y: center.y },
  ]
  const edgeLength = Math.hypot(shape.width / 2, shape.height / 2)
  if (!edgeLength) return `M ${center.x} ${center.y}`
  const offset = Math.min(Math.max(0, shape.cornerRadius), edgeLength / 2) / edgeLength
  const rounded = vertices.map((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length]!
    const next = vertices[(index + 1) % vertices.length]!
    return {
      entry: { x: vertex.x + (previous.x - vertex.x) * offset, y: vertex.y + (previous.y - vertex.y) * offset },
      exit: { x: vertex.x + (next.x - vertex.x) * offset, y: vertex.y + (next.y - vertex.y) * offset },
    }
  })
  return rounded.map((corner, index) => {
    const vertex = vertices[index]!
    const next = rounded[(index + 1) % rounded.length]!
    return `${index === 0 ? 'M' : 'L'} ${corner.entry.x} ${corner.entry.y} Q ${vertex.x} ${vertex.y} ${corner.exit.x} ${corner.exit.y} L ${next.entry.x} ${next.entry.y}`
  }).join(' ') + ' Z'
}

export function lineFromPoints(start: Point, end: Point, id: string, constrainAngle = false, kind: LineShape['kind'] = 'line'): LineShape {
  const constrainedEnd = constrainAngle ? angleConstrainedEndPoint(start, end) : end
  return { id, kind, start: { ...start }, end: { ...constrainedEnd } }
}

export function lineControlPoint(line: LineShape): Point {
  const midpoint = { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 }
  if (typeof line.curve === 'object' && line.curve) return { ...line.curve }
  const delta = { x: line.end.x - line.start.x, y: line.end.y - line.start.y }
  const length = Math.hypot(delta.x, delta.y)
  if (!length) return midpoint
  const curve = line.curve ?? 0
  return { x: midpoint.x - (delta.y / length) * curve, y: midpoint.y + (delta.x / length) * curve }
}

export function linePath(line: LineShape): string {
  const control = lineControlPoint(line)
  return `M ${line.start.x} ${line.start.y} Q ${control.x} ${control.y} ${line.end.x} ${line.end.y}`
}

export function lineArrowHeadPath(line: LineShape, size = 8): string {
  const control = lineControlPoint(line)
  const direction = { x: line.end.x - control.x, y: line.end.y - control.y }
  const length = Math.hypot(direction.x, direction.y)
  if (!length) return ''
  const unit = { x: direction.x / length, y: direction.y / length }
  const base = { x: line.end.x - unit.x * size, y: line.end.y - unit.y * size }
  const wing = { x: -unit.y * size * 0.55, y: unit.x * size * 0.55 }
  return `M ${line.end.x} ${line.end.y} L ${base.x + wing.x} ${base.y + wing.y} L ${base.x - wing.x} ${base.y - wing.y} Z`
}

export function linePointAt(line: LineShape, t: number): Point {
  const control = lineControlPoint(line)
  const inverse = 1 - t
  return {
    x: inverse * inverse * line.start.x + 2 * inverse * t * control.x + t * t * line.end.x,
    y: inverse * inverse * line.start.y + 2 * inverse * t * control.y + t * t * line.end.y,
  }
}

function squareEndPoint(start: Point, end: Point): Point {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const size = Math.max(Math.abs(deltaX), Math.abs(deltaY))
  return {
    x: start.x + Math.sign(deltaX || 1) * size,
    y: start.y + Math.sign(deltaY || 1) * size,
  }
}

function angleConstrainedEndPoint(start: Point, end: Point): Point {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const length = Math.hypot(deltaX, deltaY)
  if (length === 0) return end
  const angle = Math.round((Math.atan2(deltaY, deltaX) * 180) / Math.PI / 45) * 45
  const radians = (angle * Math.PI) / 180
  return { x: start.x + length * Math.cos(radians), y: start.y + length * Math.sin(radians) }
}

export function createId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return prefix + '-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
