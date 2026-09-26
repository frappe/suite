export const MIN_SCALE = 0.1
export const MAX_SCALE = 8
export const BASE_DOT_INTERVAL = 24
export const MIN_DOT_SCREEN_SPACING = 12

export type Point = { x: number; y: number }

export type Viewport = {
  translationX: number
  translationY: number
  scale: number
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.translationX,
    y: point.y * viewport.scale + viewport.translationY,
  }
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  if (!Number.isFinite(viewport.scale) || viewport.scale <= 0) {
    throw new RangeError('Viewport scale must be finite and greater than zero')
  }
  return {
    x: (point.x - viewport.translationX) / viewport.scale,
    y: (point.y - viewport.translationY) / viewport.scale,
  }
}

export function zoomAt(viewport: Viewport, screenPoint: Point, requestedScale: number): Viewport {
  const scale = clampScale(requestedScale)
  const worldPoint = screenToWorld(screenPoint, viewport)
  return {
    scale,
    translationX: screenPoint.x - worldPoint.x * scale,
    translationY: screenPoint.y - worldPoint.y * scale,
  }
}

export function resizeAroundCenter(
  viewport: Viewport,
  oldSize: Point,
  newSize: Point,
): Viewport {
  if (oldSize.x <= 0 || oldSize.y <= 0) {
    return { ...viewport, translationX: newSize.x / 2, translationY: newSize.y / 2 }
  }
  const oldCenterWorld = screenToWorld({ x: oldSize.x / 2, y: oldSize.y / 2 }, viewport)
  return {
    ...viewport,
    translationX: newSize.x / 2 - oldCenterWorld.x * viewport.scale,
    translationY: newSize.y / 2 - oldCenterWorld.y * viewport.scale,
  }
}

export function dotInterval(scale: number): number {
  const safeScale = clampScale(scale)
  let interval = BASE_DOT_INTERVAL
  while (interval * safeScale < MIN_DOT_SCREEN_SPACING) interval *= 2
  return interval
}

export function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

export function nextZoomStep(scale: number, direction: -1 | 1): number {
  const percent = Math.round(scale * 100)
  return clampScale((percent + direction * 10) / 100)
}
