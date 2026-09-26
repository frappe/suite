import type { Point } from './geometry'
import { rectangleCorners, rectangleCenter, rotatePoint } from './rectangle-interactions'
import { lineControlPoint } from './scene'
import type { RectangleShape, TextShape, ImageShape, LineShape, FreeDrawShape, TextAlign, TextFontFamily, TextFontWeight } from './scene'

export type Shape = RectangleShape | TextShape | ImageShape | FreeDrawShape | LineShape
export type Scene = { rectangles: (RectangleShape | TextShape | ImageShape | FreeDrawShape)[]; lines: LineShape[] }
export function isLine(shape: Shape): shape is LineShape { return 'kind' in shape && (shape.kind === 'line' || shape.kind === 'arrow') }
export function bounds(shapes: Shape[]): RectangleShape | undefined {
  if (!shapes.length) return
  const points = shapes.flatMap(shape => isLine(shape) ? [shape.start, shape.end, lineControlPoint(shape)] : isFreeDraw(shape) ? shape.points : Object.values(rectangleCorners(shape)))
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
  return { id: 'selection', x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y, rotation: 0, cornerRadius: 0 }
}
export function transformShape(shape: Shape, from: RectangleShape, to: RectangleShape): Shape {
  const a = rectangleCenter(from), b = rectangleCenter(to)
  const sx = from.width ? to.width / from.width : 1, sy = from.height ? to.height / from.height : 1
  const angle = to.rotation - from.rotation
  const map = (p: Point) => rotatePoint({ x: b.x + (p.x - a.x) * sx, y: b.y + (p.y - a.y) * sy }, b, angle)
  if (isLine(shape)) {
    return {
      ...shape,
      start: map(shape.start),
      end: map(shape.end),
      curve: typeof shape.curve === 'object' ? map(shape.curve) : shape.curve === undefined ? undefined : shape.curve * Math.min(sx, sy),
    }
  }
  if (isFreeDraw(shape)) {
    const points = shape.points.map(map)
    const xs = points.map(point => point.x), ys = points.map(point => point.y)
    return { ...shape, points, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  const center = map(rectangleCenter(shape))
  const radians = shape.rotation * Math.PI / 180
  const width = shape.width * Math.hypot(sx * Math.cos(radians), sy * Math.sin(radians))
  const height = shape.height * Math.hypot(sx * Math.sin(radians), sy * Math.cos(radians))
  const scale = Math.min(sx, sy)
  const result = { ...shape, x: center.x - width / 2, y: center.y - height / 2, width, height, rotation: shape.rotation + angle, cornerRadius: shape.cornerRadius * scale }
  if (result.labelFontSize) result.labelFontSize *= scale
  const text = result as TextShape
  if (text.kind === 'text') text.fontSize = Math.max(1, text.fontSize * scale)
  return result
}
export function parseScene(value: unknown): Scene {
  if (!value || typeof value !== 'object') throw new Error('Invalid drawing')
  const scene = JSON.parse(JSON.stringify(value)) as Scene
  if (!Array.isArray(scene.rectangles) || !Array.isArray(scene.lines) || scene.rectangles.length + scene.lines.length > 10000) throw new Error('Invalid drawing')
  const ids = new Set<string>()
  for (const shape of [...scene.rectangles, ...scene.lines]) {
    if (!shape || typeof shape !== 'object' || typeof shape.id !== 'string' || ids.has(shape.id)) throw new Error('Invalid object')
    ids.add(shape.id)
    if (shape.groupId !== undefined && typeof shape.groupId !== 'string') throw new Error('Invalid group')
    if (shape.order !== undefined && !Number.isFinite(shape.order)) throw new Error('Invalid layer')
    const rectangle = shape as RectangleShape
    if (rectangle.label !== undefined && typeof rectangle.label !== 'string') throw new Error('Invalid label')
    if (rectangle.labelFontSize !== undefined && (!Number.isFinite(rectangle.labelFontSize) || rectangle.labelFontSize <= 0)) throw new Error('Invalid label size')
    if (rectangle.labelFontFamily !== undefined && !(['shantell', 'inter', 'georgia', 'mono'] satisfies TextFontFamily[]).includes(rectangle.labelFontFamily)) throw new Error('Invalid label font')
    if (rectangle.labelFill !== undefined && typeof rectangle.labelFill !== 'string') throw new Error('Invalid label fill')
    if (rectangle.labelFontWeight !== undefined && !([400, 500, 600, 700] satisfies TextFontWeight[]).includes(rectangle.labelFontWeight)) throw new Error('Invalid label weight')
    if (rectangle.labelFontStyle !== undefined && !['normal', 'italic'].includes(rectangle.labelFontStyle)) throw new Error('Invalid label style')
    if (rectangle.labelTextDecoration !== undefined && !['none', 'underline', 'line-through'].includes(rectangle.labelTextDecoration)) throw new Error('Invalid label decoration')
    if (rectangle.labelTextAlign !== undefined && !(['left', 'center', 'right', 'justify'] satisfies TextAlign[]).includes(rectangle.labelTextAlign)) throw new Error('Invalid label alignment')
    if ('stroke' in shape && shape.stroke !== undefined && shape.stroke !== null && typeof shape.stroke !== 'string') throw new Error('Invalid stroke')
    if (isLine(shape) && shape.arrowHeadFill !== undefined && typeof shape.arrowHeadFill !== 'string') throw new Error('Invalid arrow head fill')
    if ('fill' in shape && shape.fill !== undefined && typeof shape.fill !== 'string') throw new Error('Invalid fill')
    if ('strokeWidth' in shape && shape.strokeWidth !== undefined && (!Number.isFinite(shape.strokeWidth) || shape.strokeWidth <= 0)) throw new Error('Invalid stroke width')
    if ('strokeStyle' in shape && shape.strokeStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(shape.strokeStyle)) throw new Error('Invalid stroke style')
    if ('opacity' in shape && shape.opacity !== undefined && (!Number.isFinite(shape.opacity) || shape.opacity < 0 || shape.opacity > 1)) throw new Error('Invalid opacity')
    const curveNumbers = isLine(shape)
      ? typeof shape.curve === 'number'
        ? [shape.curve]
        : shape.curve === undefined
          ? []
          : [shape.curve?.x, shape.curve?.y]
      : []
    const numbers = isLine(shape) ? [shape.start?.x, shape.start?.y, shape.end?.x, shape.end?.y, ...curveNumbers] : [shape.x, shape.y, shape.width, shape.height, shape.rotation, shape.cornerRadius]
    if (!numbers.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e8)) throw new Error('Invalid geometry')
    if (!isLine(shape) && (shape.width < 0 || shape.height < 0)) throw new Error('Invalid size')
    if ('kind' in shape && !['diamond', 'ellipse', 'text', 'image', 'freedraw', 'line', 'arrow'].includes(String(shape.kind))) throw new Error('Invalid shape')
    if (isFreeDraw(shape) && (!Array.isArray(shape.points) || shape.points.length > 100000 || !shape.points.flatMap(point => [point.x, point.y]).every(Number.isFinite))) throw new Error('Invalid free draw')
    const text = shape as TextShape
    if (text.kind === 'text') {
      if ((text as { fontFamily?: unknown }).fontFamily === 'monday') text.fontFamily = 'shantell'
      if (typeof text.text !== 'string' || !Number.isFinite(text.fontSize) || text.fontSize <= 0) throw new Error('Invalid text')
      if (text.fontFamily !== undefined && !(['shantell', 'inter', 'georgia', 'mono'] satisfies TextFontFamily[]).includes(text.fontFamily)) throw new Error('Invalid text font')
      if (text.backgroundColor !== undefined && typeof text.backgroundColor !== 'string') throw new Error('Invalid text background color')
      if (text.fontWeight !== undefined && !([400, 500, 600, 700] satisfies TextFontWeight[]).includes(text.fontWeight)) throw new Error('Invalid text weight')
      if (text.fontStyle !== undefined && !['normal', 'italic'].includes(text.fontStyle)) throw new Error('Invalid text style')
      if (text.textDecoration !== undefined && !['none', 'underline', 'line-through'].includes(text.textDecoration)) throw new Error('Invalid text decoration')
      if (text.textAlign !== undefined && !(['left', 'center', 'right', 'justify'] satisfies TextAlign[]).includes(text.textAlign)) throw new Error('Invalid text alignment')
    }
    const image = shape as ImageShape
    if (image.kind === 'image') {
      if (typeof image.src !== 'string' || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(image.src)) throw new Error('Invalid image')
      if ((image.naturalWidth !== undefined || image.naturalHeight !== undefined) && (!Number.isFinite(image.naturalWidth) || !Number.isFinite(image.naturalHeight) || image.naturalWidth! <= 0 || image.naturalHeight! <= 0)) throw new Error('Invalid image size')
      if (image.crop && (!image.naturalWidth || !image.naturalHeight || ![image.crop.x, image.crop.y, image.crop.width, image.crop.height].every(Number.isFinite) || image.crop.x < 0 || image.crop.y < 0 || image.crop.width <= 0 || image.crop.height <= 0 || image.crop.x + image.crop.width > image.naturalWidth || image.crop.y + image.crop.height > image.naturalHeight)) throw new Error('Invalid image crop')
    }
    if ('link' in shape && shape.link !== undefined && (typeof shape.link !== 'string' || shape.link.length > 2048)) throw new Error('Invalid link')
  }
  if (scene.rectangles.some(isLine) || scene.lines.some(s => !isLine(s))) throw new Error('Invalid shape list')
  return scene
}

export function isFreeDraw(shape: Shape): shape is FreeDrawShape { return (shape as { kind?: string }).kind === 'freedraw' }
