import type { Point } from './geometry'
import { constrainRotationAngle, snapRotationAngle } from './rotation'
import type { RectangleShape } from './scene'

export type Corner = 'northwest' | 'northeast' | 'southeast' | 'southwest'
export type Edge = 'north' | 'east' | 'south' | 'west'

export function rectangleCenter(rectangle: RectangleShape): Point {
  return { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 }
}

export function rectangleCorners(rectangle: RectangleShape): Record<Corner, Point> {
  const center = rectangleCenter(rectangle)
  return {
    northwest: rotatePoint({ x: rectangle.x, y: rectangle.y }, center, rectangle.rotation),
    northeast: rotatePoint({ x: rectangle.x + rectangle.width, y: rectangle.y }, center, rectangle.rotation),
    southeast: rotatePoint(
      { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
      center,
      rectangle.rotation,
    ),
    southwest: rotatePoint({ x: rectangle.x, y: rectangle.y + rectangle.height }, center, rectangle.rotation),
  }
}

export function containsPoint(rectangle: RectangleShape, point: Point): boolean {
  const local = rotatePoint(point, rectangleCenter(rectangle), -rectangle.rotation)
  if ('kind' in rectangle && rectangle.kind === 'ellipse') {
    const center = rectangleCenter(rectangle)
    const radiusX = rectangle.width / 2
    const radiusY = rectangle.height / 2
    if (radiusX === 0 || radiusY === 0) return false
    return ((local.x - center.x) / radiusX) ** 2 + ((local.y - center.y) / radiusY) ** 2 <= 1
  }
  if ('kind' in rectangle && rectangle.kind === 'diamond') {
    const center = rectangleCenter(rectangle)
    const halfWidth = rectangle.width / 2
    const halfHeight = rectangle.height / 2
    if (halfWidth === 0 || halfHeight === 0) return false
    return Math.abs(local.x - center.x) / halfWidth + Math.abs(local.y - center.y) / halfHeight <= 1
  }
  return (
    local.x >= rectangle.x &&
    local.x <= rectangle.x + rectangle.width &&
    local.y >= rectangle.y &&
    local.y <= rectangle.y + rectangle.height
  )
}

export function moveRectangle(rectangle: RectangleShape, delta: Point): RectangleShape {
  return { ...rectangle, x: rectangle.x + delta.x, y: rectangle.y + delta.y }
}

export function resizeFromCorner(
  rectangle: RectangleShape,
  corner: Corner,
  pointer: Point,
  constrainProportions = false,
): RectangleShape {
  return resizeAroundFixedAnchor(
    rectangle,
    pointer,
    unrotatedCorner(rectangle, oppositeCorner(corner)),
    true,
    true,
    constrainProportions,
  )
}

export function resizeFromEdge(
  rectangle: RectangleShape,
  edge: Edge,
  pointer: Point,
  constrainProportions = false,
): RectangleShape {
  const isHorizontal = edge === 'east' || edge === 'west'
  const fixed = isHorizontal
    ? edge === 'east'
      ? rectangle.x
      : rectangle.x + rectangle.width
    : edge === 'south'
      ? rectangle.y
      : rectangle.y + rectangle.height
  return resizeAroundFixedAnchor(
    rectangle,
    pointer,
    isHorizontal ? { x: fixed, y: rectangleCenter(rectangle).y } : { x: rectangleCenter(rectangle).x, y: fixed },
    isHorizontal,
    !isHorizontal,
    constrainProportions,
  )
}

export function setCornerRadius(rectangle: RectangleShape, corner: Corner, pointer: Point): RectangleShape {
  const local = rotatePoint(pointer, rectangleCenter(rectangle), -rectangle.rotation)
  const horizontal = corner === 'northwest' || corner === 'southwest'
    ? local.x - rectangle.x
    : rectangle.x + rectangle.width - local.x
  const vertical = corner === 'northwest' || corner === 'northeast'
    ? local.y - rectangle.y
    : rectangle.y + rectangle.height - local.y
  const radius = Math.min(Math.max(0, Math.min(horizontal, vertical)), rectangle.width / 2, rectangle.height / 2)
  return { ...rectangle, cornerRadius: radius }
}

export function rotateRectangle(
  rectangle: RectangleShape,
  startPointer: Point,
  pointer: Point,
  constrainRotation = false,
): RectangleShape {
  const center = rectangleCenter(rectangle)
  const delta = angleFrom(center, pointer) - angleFrom(center, startPointer)
  const rotation = rectangle.rotation + delta
  return { ...rectangle, rotation: constrainRotation ? constrainRotationAngle(rotation, 15) : snapRotationAngle(rotation, 45, 4) }
}

export function rotatePoint(point: Point, center: Point, angle: number): Point {
  const radians = (angle * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const x = point.x - center.x
  const y = point.y - center.y
  return { x: center.x + x * cosine - y * sine, y: center.y + x * sine + y * cosine }
}

function angleFrom(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI
}

function resizeAroundFixedAnchor(
  rectangle: RectangleShape,
  pointer: Point,
  fixed: Point,
  resizeWidth: boolean,
  resizeHeight: boolean,
  constrainProportions: boolean,
): RectangleShape {
  const center = rectangleCenter(rectangle)
  let localPointer = rotatePoint(pointer, center, -rectangle.rotation)
  let width = resizeWidth ? Math.abs(localPointer.x - fixed.x) : rectangle.width
  let height = resizeHeight ? Math.abs(localPointer.y - fixed.y) : rectangle.height
  if (constrainProportions && rectangle.width > 0 && rectangle.height > 0) {
    const constrained = constrainedDimensions(rectangle, width, height, resizeWidth, resizeHeight)
    width = constrained.width
    height = constrained.height
    localPointer = {
      x: resizeWidth ? fixed.x + Math.sign(localPointer.x - fixed.x || 1) * width : localPointer.x,
      y: resizeHeight ? fixed.y + Math.sign(localPointer.y - fixed.y || 1) * height : localPointer.y,
    }
  }
  const localCenter = {
    x: resizeWidth ? (localPointer.x + fixed.x) / 2 : center.x,
    y: resizeHeight ? (localPointer.y + fixed.y) / 2 : center.y,
  }
  const nextCenter = rotatePoint(localCenter, center, rectangle.rotation)
  return clampCornerRadius({
    ...rectangle,
    x: nextCenter.x - width / 2,
    y: nextCenter.y - height / 2,
    width,
    height,
  })
}

function constrainedDimensions(
  rectangle: RectangleShape,
  width: number,
  height: number,
  resizeWidth: boolean,
  resizeHeight: boolean,
): Pick<RectangleShape, 'width' | 'height'> {
  const aspectRatio = rectangle.width / rectangle.height
  if (resizeWidth && resizeHeight) {
    return width / rectangle.width >= height / rectangle.height
      ? { width, height: width / aspectRatio }
      : { width: height * aspectRatio, height }
  }
  return resizeWidth ? { width, height: width / aspectRatio } : { width: height * aspectRatio, height }
}

function unrotatedCorner(rectangle: RectangleShape, corner: Corner): Point {
  const x = corner === 'northwest' || corner === 'southwest' ? rectangle.x : rectangle.x + rectangle.width
  const y = corner === 'northwest' || corner === 'northeast' ? rectangle.y : rectangle.y + rectangle.height
  return { x, y }
}

function oppositeCorner(corner: Corner): Corner {
  const corners: Record<Corner, Corner> = {
    northwest: 'southeast',
    northeast: 'southwest',
    southeast: 'northwest',
    southwest: 'northeast',
  }
  return corners[corner]
}

function clampCornerRadius(rectangle: RectangleShape): RectangleShape {
  return { ...rectangle, cornerRadius: Math.min(rectangle.cornerRadius, rectangle.width / 2, rectangle.height / 2) }
}
