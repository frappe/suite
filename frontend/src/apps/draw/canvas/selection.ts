import { translate as __ } from '@/platform/translation'

import type { Point } from './geometry'
import { rectangleCenter, rectangleCorners, rotatePoint } from './rectangle-interactions'
import {
  DEFAULT_FREE_DRAW_PRESSURE,
  lineControlPoint,
  type DiamondShape,
  type EllipseShape,
  type FreeDrawShape,
  type ImageShape,
  type LineShape,
  type RectangleShape,
  type TextAlign,
  type TextFontFamily,
  type TextFontWeight,
  type TextShape,
} from './scene'

type PlainRectangleShape = RectangleShape & { kind?: never }

export type Shape =
  | PlainRectangleShape
  | EllipseShape
  | DiamondShape
  | TextShape
  | ImageShape
  | FreeDrawShape
  | LineShape
export type Scene = {
  rectangles: (
    PlainRectangleShape | EllipseShape | DiamondShape | TextShape | ImageShape | FreeDrawShape
  )[]
  lines: LineShape[]
}
export function isLine(shape: Shape): shape is LineShape {
  return 'kind' in shape && (shape.kind === 'line' || shape.kind === 'arrow')
}
export function bounds(shapes: Shape[]): RectangleShape | undefined {
  if (!shapes.length) return
  const points = shapes.flatMap((shape) =>
    isLine(shape)
      ? [shape.start, shape.end, lineControlPoint(shape)]
      : isFreeDraw(shape)
        ? shape.points
        : Object.values(rectangleCorners(shape)),
  )
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y))
  return {
    id: 'selection',
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
    rotation: 0,
    cornerRadius: 0,
  }
}
export function transformShape(shape: Shape, from: RectangleShape, to: RectangleShape): Shape {
  const a = rectangleCenter(from),
    b = rectangleCenter(to)
  const sx = from.width ? to.width / from.width : 1,
    sy = from.height ? to.height / from.height : 1
  const angle = to.rotation - from.rotation
  const map = (p: Point) =>
    rotatePoint({ x: b.x + (p.x - a.x) * sx, y: b.y + (p.y - a.y) * sy }, b, angle)
  if (isLine(shape)) {
    return {
      ...shape,
      start: map(shape.start),
      end: map(shape.end),
      curve:
        typeof shape.curve === 'object'
          ? map(shape.curve)
          : shape.curve === undefined
            ? undefined
            : shape.curve * Math.min(sx, sy),
    }
  }
  if (isFreeDraw(shape)) {
    const points = shape.points.map(map)
    const xs = points.map((point) => point.x),
      ys = points.map((point) => point.y)
    return {
      ...shape,
      points,
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    }
  }
  const center = map(rectangleCenter(shape))
  const radians = (shape.rotation * Math.PI) / 180
  const width = shape.width * Math.hypot(sx * Math.cos(radians), sy * Math.sin(radians))
  const height = shape.height * Math.hypot(sx * Math.sin(radians), sy * Math.cos(radians))
  const scale = Math.min(sx, sy)
  const result = {
    ...shape,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    rotation: shape.rotation + angle,
    cornerRadius: shape.cornerRadius * scale,
  }
  if (result.labelFontSize) result.labelFontSize *= scale
  if ('kind' in result && result.kind === 'text')
    result.fontSize = Math.max(1, result.fontSize * scale)
  return result
}
function validateLabels(shape: Shape) {
  const label = 'label' in shape ? shape.label : undefined
  const labelFontSize = 'labelFontSize' in shape ? shape.labelFontSize : undefined
  const labelFontFamily = 'labelFontFamily' in shape ? shape.labelFontFamily : undefined
  const labelFill = 'labelFill' in shape ? shape.labelFill : undefined
  const labelFontWeight = 'labelFontWeight' in shape ? shape.labelFontWeight : undefined
  const labelFontStyle = 'labelFontStyle' in shape ? shape.labelFontStyle : undefined
  const labelTextDecoration = 'labelTextDecoration' in shape ? shape.labelTextDecoration : undefined
  const labelTextAlign = 'labelTextAlign' in shape ? shape.labelTextAlign : undefined
  if (label !== undefined && typeof label !== 'string') throw new Error(__('Invalid label'))
  if (
    labelFontSize !== undefined &&
    (typeof labelFontSize !== 'number' || !Number.isFinite(labelFontSize) || labelFontSize <= 0)
  )
    throw new Error(__('Invalid label size'))
  if (
    labelFontFamily !== undefined &&
    !(['shantell', 'inter', 'georgia', 'mono'] satisfies TextFontFamily[]).some(
      (family) => family === labelFontFamily,
    )
  )
    throw new Error(__('Invalid label font'))
  if (labelFill !== undefined && typeof labelFill !== 'string')
    throw new Error(__('Invalid label fill'))
  if (
    labelFontWeight !== undefined &&
    !([400, 500, 600, 700] satisfies TextFontWeight[]).some((weight) => weight === labelFontWeight)
  )
    throw new Error(__('Invalid label weight'))
  if (
    labelFontStyle !== undefined &&
    !['normal', 'italic'].some((style) => style === labelFontStyle)
  )
    throw new Error(__('Invalid label style'))
  if (
    labelTextDecoration !== undefined &&
    !['none', 'underline', 'line-through'].some((decoration) => decoration === labelTextDecoration)
  )
    throw new Error(__('Invalid label decoration'))
  if (
    labelTextAlign !== undefined &&
    !(['left', 'center', 'right', 'justify'] satisfies TextAlign[]).some(
      (align) => align === labelTextAlign,
    )
  )
    throw new Error(__('Invalid label alignment'))
}

export function parseScene(value: unknown): Scene {
  if (!value || typeof value !== 'object') throw new Error(__('Invalid drawing'))
  // SAFETY: this view is local to the parser: every shape's identity, geometry,
  // discriminator and kind-specific fields are checked below before the Scene can escape.
  const scene = JSON.parse(JSON.stringify(value)) as Scene
  if (
    !Array.isArray(scene.rectangles) ||
    !Array.isArray(scene.lines) ||
    scene.rectangles.length + scene.lines.length > 10000
  )
    throw new Error(__('Invalid drawing'))
  const ids = new Set<string>()
  for (const shape of [...scene.rectangles, ...scene.lines]) {
    if (!shape || typeof shape !== 'object' || typeof shape.id !== 'string' || ids.has(shape.id))
      throw new Error(__('Invalid object'))
    ids.add(shape.id)
    if (shape.groupId !== undefined && typeof shape.groupId !== 'string')
      throw new Error(__('Invalid group'))
    if (shape.order !== undefined && !Number.isFinite(shape.order))
      throw new Error(__('Invalid layer'))
    validateLabels(shape)
    if (
      'stroke' in shape &&
      shape.stroke !== undefined &&
      shape.stroke !== null &&
      typeof shape.stroke !== 'string'
    )
      throw new Error(__('Invalid stroke'))
    if (
      isLine(shape) &&
      shape.arrowHeadFill !== undefined &&
      typeof shape.arrowHeadFill !== 'string'
    )
      throw new Error(__('Invalid arrow head fill'))
    if ('fill' in shape && shape.fill !== undefined && typeof shape.fill !== 'string')
      throw new Error(__('Invalid fill'))
    if (
      'strokeWidth' in shape &&
      shape.strokeWidth !== undefined &&
      (!Number.isFinite(shape.strokeWidth) || shape.strokeWidth <= 0)
    )
      throw new Error(__('Invalid stroke width'))
    if (
      'strokeStyle' in shape &&
      shape.strokeStyle !== undefined &&
      !['solid', 'dashed', 'dotted'].includes(shape.strokeStyle)
    )
      throw new Error(__('Invalid stroke style'))
    if (
      'opacity' in shape &&
      shape.opacity !== undefined &&
      (!Number.isFinite(shape.opacity) || shape.opacity < 0 || shape.opacity > 1)
    )
      throw new Error(__('Invalid opacity'))
    const curveNumbers = isLine(shape)
      ? typeof shape.curve === 'number'
        ? [shape.curve]
        : shape.curve === undefined
          ? []
          : [shape.curve?.x, shape.curve?.y]
      : []
    const numbers = isLine(shape)
      ? [shape.start?.x, shape.start?.y, shape.end?.x, shape.end?.y, ...curveNumbers]
      : [shape.x, shape.y, shape.width, shape.height, shape.rotation, shape.cornerRadius]
    if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e8))
      throw new Error(__('Invalid geometry'))
    if (!isLine(shape) && (shape.width < 0 || shape.height < 0)) throw new Error(__('Invalid size'))
    if (
      'kind' in shape &&
      !['diamond', 'ellipse', 'text', 'image', 'freedraw', 'line', 'arrow'].includes(
        String(shape.kind),
      )
    )
      throw new Error(__('Invalid shape'))
    if (
      isFreeDraw(shape) &&
      (!Array.isArray(shape.points) ||
        shape.points.length > 100000 ||
        !shape.points.flatMap((point) => [point.x, point.y]).every(Number.isFinite))
    )
      throw new Error(__('Invalid free draw'))
    if (isFreeDraw(shape)) {
      const pressures = shape.pressures
      if (pressures === undefined) {
        shape.pressures = shape.points.map(() => DEFAULT_FREE_DRAW_PRESSURE)
      } else if (
        !Array.isArray(pressures) ||
        pressures.length !== shape.points.length ||
        !pressures.every(
          (pressure) =>
            typeof pressure === 'number' &&
            Number.isFinite(pressure) &&
            pressure >= 0 &&
            pressure <= 1,
        )
      ) {
        throw new Error(__('Invalid free draw pressure'))
      }
    }
    if ('kind' in shape && shape.kind === 'text') {
      const text = shape
      if (['monday'].includes(text.fontFamily ?? '')) text.fontFamily = 'shantell'
      if (typeof text.text !== 'string' || !Number.isFinite(text.fontSize) || text.fontSize <= 0)
        throw new Error(__('Invalid text'))
      if (
        text.fontFamily !== undefined &&
        !(['shantell', 'inter', 'georgia', 'mono'] satisfies TextFontFamily[]).includes(
          text.fontFamily,
        )
      )
        throw new Error(__('Invalid text font'))
      if (text.backgroundColor !== undefined && typeof text.backgroundColor !== 'string')
        throw new Error(__('Invalid text background color'))
      if (
        text.fontWeight !== undefined &&
        !([400, 500, 600, 700] satisfies TextFontWeight[]).includes(text.fontWeight)
      )
        throw new Error(__('Invalid text weight'))
      if (text.fontStyle !== undefined && !['normal', 'italic'].includes(text.fontStyle))
        throw new Error(__('Invalid text style'))
      if (
        text.textDecoration !== undefined &&
        !['none', 'underline', 'line-through'].includes(text.textDecoration)
      )
        throw new Error(__('Invalid text decoration'))
      if (
        text.textAlign !== undefined &&
        !(['left', 'center', 'right', 'justify'] satisfies TextAlign[]).includes(text.textAlign)
      )
        throw new Error(__('Invalid text alignment'))
    }
    if ('kind' in shape && shape.kind === 'image') {
      const image = shape
      if (
        typeof image.src !== 'string' ||
        !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(image.src)
      )
        throw new Error(__('Invalid image'))
      if (
        (image.naturalWidth !== undefined || image.naturalHeight !== undefined) &&
        (!Number.isFinite(image.naturalWidth) ||
          !Number.isFinite(image.naturalHeight) ||
          image.naturalWidth! <= 0 ||
          image.naturalHeight! <= 0)
      )
        throw new Error(__('Invalid image size'))
      if (
        image.crop &&
        (!image.naturalWidth ||
          !image.naturalHeight ||
          ![image.crop.x, image.crop.y, image.crop.width, image.crop.height].every(
            Number.isFinite,
          ) ||
          image.crop.x < 0 ||
          image.crop.y < 0 ||
          image.crop.width <= 0 ||
          image.crop.height <= 0 ||
          image.crop.x + image.crop.width > image.naturalWidth ||
          image.crop.y + image.crop.height > image.naturalHeight)
      )
        throw new Error(__('Invalid image crop'))
    }
    if (
      'link' in shape &&
      shape.link !== undefined &&
      (typeof shape.link !== 'string' || shape.link.length > 2048)
    )
      throw new Error(__('Invalid link'))
  }
  if (scene.rectangles.some(isLine) || scene.lines.some((s) => !isLine(s)))
    throw new Error(__('Invalid shape list'))
  return scene
}

export function isFreeDraw(shape: Shape): shape is FreeDrawShape {
  return 'kind' in shape && shape.kind === 'freedraw'
}
