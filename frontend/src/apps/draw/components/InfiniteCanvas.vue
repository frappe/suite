<script setup lang="ts">
import { loadDrawing, queueSave, drawingTitle, warnUnsaved, saveDrawing, drawingLoading } from '../canvas/persistence'
import { bounds, transformShape, isFreeDraw, isLine, parseScene, type Shape } from '../canvas/selection'
import { Button, Icon, Select, Tooltip, TooltipProvider } from 'frappe-ui'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Italic, Minus, Plus, Redo2, Underline, Undo2 } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  MAX_SCALE,
  MIN_SCALE,
  dotInterval,
  nextZoomStep,
  positiveModulo,
  resizeAroundCenter,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Point,
  type Viewport,
} from '../canvas/geometry'
import {
  createId,
  diamondFromPoints,
  diamondPath,
  ellipseFromPoints,
  freeDrawPath,
  isClosedFreeDraw,
  lineFromPoints,
  lineControlPoint,
  lineArrowHeadPath,
  linePointAt,
  linePath,
  type ImageShape,
  type FreeDrawShape,
  rectangleFromPoints,
  type LineShape,
  type RectangleShape,
  type TextAlign,
  type TextShape,
  type TextFontFamily,
} from '../canvas/scene'
import {
  containsPoint,
  moveRectangle,
  rectangleCenter,
  rectangleCorners,
  rotatePoint,
  rotateRectangle,
  resizeFromEdge,
  resizeFromCorner,
  setCornerRadius,
  type Corner,
  type Edge,
} from '../canvas/rectangle-interactions'
import { moveLine, rotateLineEndpoint, setLineCurve, type LineHandle } from '../canvas/line-interactions'
import {
  snapResizeHandlePoint,
  snapShapeMove,
  type AlignmentGuide,
  type SpacingMarker,
} from '../canvas/snapping'
import type { DrawingTool } from '../canvas/tools'
import { layoutText, TEXT_FONT_FAMILIES, TEXT_LINE_HEIGHT } from '../canvas/text-layout'
import SnapGuides from './SnapGuides.vue'
import LaserTrail from './LaserTrail.vue'
import rotateCursorSvg from '../assets/rotate-cursor-white.svg?raw'
import ShapeColorPicker from './ShapeColorPicker.vue'
import CanvasMinimap from './CanvasMinimap.vue'

type PointerSample = Point & { pointerType: string }
type TextStylePatch = Partial<Pick<TextShape, 'fill' | 'backgroundColor' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'textDecoration' | 'textAlign' | 'opacity' | 'fontSize'>>
type ObjectColor = { label: string; border: string; fill: string }
type SolidColor = { label: string; color: string }

const objectColors: ObjectColor[] = [
  { label: 'Blue', border: '#0070cc', fill: '#e6f4ff' },
  { label: 'Green', border: '#278f5e', fill: '#e4faeb' },
  { label: 'Red', border: '#b52a2a', fill: '#ffe7e7' },
]
const solidColors: SolidColor[] = objectColors.map(({ label, border: color }) => ({ label, color }))
const fontOptions = [
  { label: 'Shantell', value: 'shantell' },
  { label: 'Inter', value: 'inter' },
  { label: 'Georgia', value: 'georgia' },
  { label: 'Monospace', value: 'mono' },
] satisfies { label: string; value: TextFontFamily }[]
const fontSizeOptions = [12, 14, 16, 18, 20, 24, 32, 48].map(value => ({ label: `${value}`, value }))
const textAlignOptions = [
  { value: 'left', label: 'Align left', icon: AlignLeft },
  { value: 'center', label: 'Align center', icon: AlignCenter },
  { value: 'right', label: 'Align right', icon: AlignRight },
  { value: 'justify', label: 'Justify', icon: AlignJustify },
] satisfies { value: TextAlign; label: string; icon: typeof AlignLeft }[]

const props = defineProps<{ activeTool: DrawingTool | null }>()
const emit = defineEmits<{
  activateRectangle: []
  activateDiamond: []
  activateEllipse: []
  activateLine: []
  activateArrow: []
  activateText: []
  activateImage: []
  activateDraw: []
  activateEraser: []
  cancelTool: []
  rectangleCreated: []
  diamondCreated: []
  ellipseCreated: []
  lineCreated: []
}>()

const root = ref<HTMLElement>()
const fileInput = ref<HTMLInputElement>()
const laserTrail = ref<InstanceType<typeof LaserTrail>>()
const eraserTrail = ref<InstanceType<typeof LaserTrail>>()
let laserPointerId: number | undefined
let cancellingGesture = false
let shiftClickShape: Shape | undefined
let duplicateOnDrag = false
let cycleClickPoint: Point | undefined
let cycleClickShape: Shape | undefined
const size = reactive<Point>({ x: 0, y: 0 })
const viewport = reactive<Viewport>({ translationX: 0, translationY: 0, scale: 1 })
const minimapOpen = ref(false)
const pointers = new Map<number, PointerSample>()
const isPanning = ref(false)
const isSpacePressed = ref(false)
const isShiftPressed = ref(false)
const awaitingTouchRelease = ref(false)
const liveMessage = ref('Zoom 100%')
const linkHover = ref<{ link: string; point: Point }>()
const rectangles = ref<(RectangleShape | TextShape | ImageShape | FreeDrawShape)[]>([])
const lines = ref<LineShape[]>([])
const history: SceneSnapshot[] = [{ rectangles: [], lines: [] }]
const historySelections: string[][] = [[]]
const pendingRectangle = ref<RectangleShape>()
const pendingLine = ref<LineShape>()
const pendingText = ref<RectangleShape>()
const pendingDraw = ref<FreeDrawShape>()
const erasedShapeIds = ref<string[]>([])
const drawStyle = reactive({ stroke: '#171717' as string | null, fill: 'none', strokeWidth: 3, strokeStyle: 'solid' as const, opacity: 1 })
const croppingImageId = ref<string>()
const cropFrame = ref<RectangleShape>()
const textEditor = ref<TextEditor>()
const propertyToolbarInteracting = ref(false)
const textArea = ref<HTMLTextAreaElement>()
const selectedRectangleId = ref<string>()
const selectedLineId = ref<string>()
const selectedLabelId = ref<string>()
const selectedShapeIds = ref<string[]>([])
const multiSelectionFrame = ref<RectangleShape>()
const hoveredSelectionHandle = ref<SelectionHandle>()
const isRotating = ref(false)
const isCurving = ref(false)
const isMoveReady = ref(false)
const isHoveringSelectedShape = ref(false)
const alignmentGuides = ref<AlignmentGuide[]>([])
const spacingMarkers = ref<SpacingMarker[]>([])
const latestGesturePoint = ref<Point>()

let resizeObserver: ResizeObserver | undefined
let singlePointerStart: { point: Point; viewport: Viewport } | undefined
let pinchStart:
  | { distance: number; centroid: Point; viewport: Viewport }
  | undefined
let announceTimer: number | undefined
let viewportFrame: number | undefined
let pendingViewport: Viewport | undefined
let pendingZoomAnnouncement = false
let clipboard: SceneSnapshot | undefined
let imageInsertPoint: Point | undefined
let lastSelectPointerDown: { time: number; point: Point } | undefined
const modifiers = reactive({ alt: false, bypass: false })
const marquee = ref<RectangleShape>()
let marqueeGesture: { pointerId: number; start: Point; previous: string[] } | undefined
const enteredGroup = ref<string>()
const armedTextStyle = reactive<Pick<TextShape, 'fill' | 'backgroundColor' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'textDecoration' | 'textAlign'>>({
  fill: '#171717', backgroundColor: undefined, fontFamily: 'shantell', fontSize: 16, fontWeight: 400, fontStyle: 'normal', textDecoration: 'none', textAlign: 'left',
})
const allShapes = computed(() => [...lines.value, ...rectangles.value].sort((a,b) => (a.order ?? 0) - (b.order ?? 0)))
const selectedShapes = computed(() => allShapes.value.filter(s => selectedShapeIds.value.includes(s.id)))
const selectedTextShapes = computed(() => selectedShapes.value.every(isText) ? selectedShapes.value as TextShape[] : [])
const selectedLabel = computed(() => {
  if (selectedShapeIds.value.length !== 1 || selectedLabelId.value !== selectedShapeIds.value[0]) return undefined
  const shape = rectangles.value.find(shape => shape.id === selectedLabelId.value)
  return shape && !isText(shape) && !isImage(shape) && !isFreeDraw(shape) && shape.label ? shape : undefined
})
const textPropertyControlsEnabled = computed(() => props.activeTool !== 'draw' && (Boolean(textEditor.value) || selectedTextShapes.value.length > 0 || Boolean(selectedLabel.value) || (!selectedShapes.value.length && props.activeTool === 'text')))
const usesSolidColorPalette = computed(() => props.activeTool !== 'draw' && (selectedShapes.value.some(shape => isLine(shape) || isText(shape)) || Boolean(selectedLabel.value) || (!selectedShapes.value.length && textPropertyControlsEnabled.value)))
const propertyColorKind = computed<'shape' | 'text' | 'draw' | 'arrow' | 'line'>(() => {
  if (props.activeTool === 'draw') return 'draw'
  const shape = selectedShapes.value.at(-1)
  if (!shape || isText(shape) || shape === selectedLabel.value) return 'text'
  if (isLine(shape)) return shape.kind
  return 'shape'
})
const propertyColorTarget = computed<'border' | 'fill'>(() => props.activeTool === 'draw' ? 'fill' : selectedShapes.value.some(isLine) ? 'border' : 'fill')
const activePropertyColor = computed(() => {
  if (props.activeTool === 'draw') return drawStyle.fill === 'none' ? '#171717' : drawStyle.fill
  const shape = selectedShapes.value.at(-1)
  return shape
    ? (isLine(shape) ? (shape.kind === 'arrow' ? shape.arrowHeadFill ?? shape.stroke : shape.stroke) ?? '#171717' : shape === selectedLabel.value ? shape.labelFill ?? '#171717' : shape.fill ?? '#e6f4ff')
    : textEditor.value?.fill ?? armedTextStyle.fill
})
const activePropertyBorderColor = computed(() => {
  if (props.activeTool === 'draw') return drawStyle.stroke ?? '#171717'
  const text = selectedTextShapes.value.at(-1)
  if (text) return text.backgroundColor
  if (textEditor.value?.kind === 'text') return textEditor.value.backgroundColor
  if (!selectedShapes.value.length && textPropertyControlsEnabled.value) return armedTextStyle.backgroundColor
  return selectedShapes.value.at(-1)?.stroke ?? '#171717'
})
const activePropertyStrokeWidth = computed(() => selectedShapes.value.at(-1)?.strokeWidth ?? 2)
const activePropertyStrokeStyle = computed(() => selectedShapes.value.at(-1)?.strokeStyle ?? 'solid')
const propertyToolbarVisible = computed(() => props.activeTool !== 'eraser' && Boolean(props.activeTool === 'draw' || selectedShapes.value.length || textPropertyControlsEnabled.value))
const propertyTextStyle = computed(() => {
  const editor = textEditor.value
  const text = selectedTextShapes.value.at(-1)
  return {
    fontFamily: editor?.fontFamily ?? text?.fontFamily ?? selectedLabel.value?.labelFontFamily ?? armedTextStyle.fontFamily ?? 'shantell',
    fontSize: editor?.fontSize ?? text?.fontSize ?? selectedLabel.value?.labelFontSize ?? armedTextStyle.fontSize ?? 16,
    fontWeight: editor?.fontWeight ?? text?.fontWeight ?? selectedLabel.value?.labelFontWeight ?? armedTextStyle.fontWeight ?? 400,
    fontStyle: editor?.fontStyle ?? text?.fontStyle ?? selectedLabel.value?.labelFontStyle ?? armedTextStyle.fontStyle ?? 'normal',
    textDecoration: editor?.textDecoration ?? text?.textDecoration ?? selectedLabel.value?.labelTextDecoration ?? armedTextStyle.textDecoration ?? 'none',
    textAlign: editor?.textAlign ?? text?.textAlign ?? selectedLabel.value?.labelTextAlign ?? armedTextStyle.textAlign ?? 'center',
  }
})
const propertyTextAlignOption = computed(() => textAlignOptions.find(option => option.value === propertyTextStyle.value.textAlign) ?? textAlignOptions[0]!)
const layerActions = computed(() => ({
  front: Boolean(reorderedSelectedShapes('front')),
  forward: Boolean(reorderedSelectedShapes('forward')),
  backward: Boolean(reorderedSelectedShapes('backward')),
  back: Boolean(reorderedSelectedShapes('back')),
}))
const selectionCount = computed(() => selectedShapes.value.length)
const combinedBounds = computed(() => bounds(selectedShapes.value))
let creationLast: Point | undefined
let rectangleGesture: { pointerId: number; start: Point } | undefined
let lineGesture: { pointerId: number; start: Point } | undefined
let drawPointerId: number | undefined
let eraserPointerId: number | undefined
let eraserLastPoint: Point | undefined
let eraseOriginal: SceneSnapshot | undefined
let textGesture: { pointerId: number; start: Point; end?: Point } | undefined
let cropGesture: { pointerId: number; start: Point } | undefined
let historyIndex = 0
const historyVersion = ref(0)
type SceneSnapshot = { rectangles: (RectangleShape | TextShape | ImageShape | FreeDrawShape)[]; lines: LineShape[] }
type TextEditor = {
  kind: 'text' | 'label'
  text: string
  shapeId?: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  wrap: boolean
  fill?: string
  backgroundColor?: string
  fontFamily?: TextShape['fontFamily']
  fontWeight?: TextShape['fontWeight']
  fontStyle?: TextShape['fontStyle']
  textDecoration?: TextShape['textDecoration']
  textAlign?: TextShape['textAlign']
  original?: TextShape | RectangleShape
}
type ResizeHandle = Corner | Edge
type CurveHandle = `curve-${Corner}`
type RotationHandle = 'rotate' | `rotate-${Corner}`
type SelectionHandle = ResizeHandle | CurveHandle | 'line-curve' | RotationHandle
const HANDLE_HIT_RADIUS = 14
const ROTATION_HANDLE_OFFSET = 24
const ROTATION_HIT_RADIUS = 10
const ROTATION_CURSOR_ANGLES: Record<Corner, number> = {
  northwest: -90,
  northeast: 0,
  southeast: 90,
  southwest: 180,
}
const LINE_HIT_RADIUS = 10
const TEXT_DRAG_THRESHOLD = 6
const AUTO_PAN_EDGE = 48
const AUTO_PAN_SPEED = 12
const LABEL_PADDING = 12
const MIN_LABEL_FONT_SIZE = 12
const MAX_HISTORY_ENTRIES = 100
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

let selectionGesture:
  | {
      pointerId: number
      kind: 'move' | 'resize' | 'curve' | 'rotate'
      start: Point
      original: RectangleShape
      initial: RectangleShape
      originalScene: SceneSnapshot
      labelOriginal?: RectangleShape
      rollbackScene?: SceneSnapshot
      handle?: ResizeHandle | Corner
      handleStart?: Point
      dragStarted?: boolean
    }
  | undefined

let lineSelectionGesture:
  | {
      pointerId: number
      kind: 'move' | LineHandle
      start: Point
      original: LineShape
      originalScene: SceneSnapshot
      rollbackScene?: SceneSnapshot
    }
  | undefined

const intervalWorld = computed(() => dotInterval(viewport.scale))
const spacing = computed(() => intervalWorld.value * viewport.scale)
const patternX = computed(() => positiveModulo(viewport.translationX, spacing.value))
const patternY = computed(() => positiveModulo(viewport.translationY, spacing.value))
const zoomLabel = computed(() => `${Math.round(viewport.scale * 100)}%`)
const cursorClass = computed(() => ({
  'is-pan-ready': isSpacePressed.value && !isPanning.value,
  'is-panning': isPanning.value,
  'is-drawing-shape': ['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'draw', 'image'].includes(props.activeTool ?? ''),
  'is-erasing': props.activeTool === 'eraser',
  'is-text-ready': props.activeTool === 'text',
  'is-laser-ready': props.activeTool === 'laser' && !isSpacePressed.value && !isPanning.value,
  'is-rotation-ready': isRotateHandle(hoveredSelectionHandle.value) && !isRotating.value,
  'is-rotating': isRotating.value,
  'is-curve-ready': !isCurving.value && (hoveredSelectionHandle.value === 'line-curve' || Boolean(hoveredSelectionHandle.value && isCurveHandle(hoveredSelectionHandle.value))),
  'is-curving': isCurving.value,
  'is-move-ready': isMoveReady.value,
  'is-resize-ns': resizeCursor(hoveredSelectionHandle.value) === 'ns',
  'is-resize-ew': resizeCursor(hoveredSelectionHandle.value) === 'ew',
  'is-resize-nwse': resizeCursor(hoveredSelectionHandle.value) === 'nwse',
  'is-resize-nesw': resizeCursor(hoveredSelectionHandle.value) === 'nesw',
}))
const rotationCursorAngle = computed<number | undefined>(() => {
  const handle = hoveredSelectionHandle.value
  const rectangle = selectionFrame.value
  if (!isRotateHandle(handle) || !rectangle) return undefined
  const corner = (handle === 'rotate' ? 'northeast' : handle.slice('rotate-'.length)) as Corner
  const angle = ROTATION_CURSOR_ANGLES[corner] + rectangle.rotation
  return ((angle % 360) + 360) % 360
})
const rotationCursorStyle = computed(() => {
  const angle = rotationCursorAngle.value
  if (angle === undefined) return undefined
  return {
    cursor: `url("${rotationCursorUrl(angle)}") 12 12, ${isRotating.value ? 'grabbing' : 'grab'}`,
  }
})
const selectedRectangle = computed(() =>
  rectangles.value.find((rectangle) => rectangle.id === selectedRectangleId.value),
)
const selectedLine = computed(() => lines.value.find((line) => line.id === selectedLineId.value))
const croppingImage = computed(() => {
  const shape = rectangles.value.find(candidate => candidate.id === croppingImageId.value)
  return shape && isImage(shape) ? shape : undefined
})
const hasMultipleSelection = computed(() => selectedShapeIds.value.length > 1)
const canUndo = computed(() => {
  historyVersion.value
  return historyIndex > 0
})
const canRedo = computed(() => {
  historyVersion.value
  return historyIndex < history.length - 1
})
const selectionFrame = computed<RectangleShape | undefined>(() => {
  if (hasMultipleSelection.value && multiSelectionFrame.value) return multiSelectionFrame.value
  if (selectedLabel.value) return selectionOutline(labelSelectionBounds(selectedLabel.value))
  const rectangle = hasMultipleSelection.value ? combinedBounds.value : selectedRectangle.value
  if (!rectangle) return undefined
  return selectionOutline(rectangle)
})
const selectionItemFrames = computed(() =>
  hasMultipleSelection.value
    ? selectedShapes.value.filter((shape): shape is RectangleShape => !isLine(shape)).map(selectionOutline)
    : [],
)

function selectionOutline(rectangle: RectangleShape): RectangleShape {
  // Keep handles clear of the shape stroke at every zoom level.
  const inset = 3 / viewport.scale
  return {
    ...rectangle,
    x: rectangle.x - inset,
    y: rectangle.y - inset,
    width: rectangle.width + inset * 2,
    height: rectangle.height + inset * 2,
    cornerRadius: 0,
  }
}
const selectionCorners = computed(() =>
  selectionFrame.value ? rectangleCorners(selectionFrame.value) : undefined,
)
const selectionEdges = computed(() => {
  const rectangle = selectionFrame.value
  if (!rectangle) return undefined
  const center = rectangleCenter(rectangle)
  return {
    north: rotatePoint({ x: center.x, y: rectangle.y }, center, rectangle.rotation),
    east: rotatePoint({ x: rectangle.x + rectangle.width, y: center.y }, center, rectangle.rotation),
    south: rotatePoint({ x: center.x, y: rectangle.y + rectangle.height }, center, rectangle.rotation),
    west: rotatePoint({ x: rectangle.x, y: center.y }, center, rectangle.rotation),
  } satisfies Record<Edge, Point>
})
const curveHandles = computed(() => {
  const rectangle = selectedRectangle.value
  if (!rectangle) return undefined
  const center = rectangleCenter(rectangle)
  const offset = Math.min(
    Math.max(rectangle.cornerRadius, 20 / viewport.scale),
    rectangle.width / 3,
    rectangle.height / 3,
  )
  return {
    northwest: rotatePoint({ x: rectangle.x + offset, y: rectangle.y + offset }, center, rectangle.rotation),
    northeast: rotatePoint({ x: rectangle.x + rectangle.width - offset, y: rectangle.y + offset }, center, rectangle.rotation),
    southeast: rotatePoint({ x: rectangle.x + rectangle.width - offset, y: rectangle.y + rectangle.height - offset }, center, rectangle.rotation),
    southwest: rotatePoint({ x: rectangle.x + offset, y: rectangle.y + rectangle.height - offset }, center, rectangle.rotation),
  } satisfies Record<Corner, Point>
})
const curveHandleRadius = computed(() => {
  const rectangle = selectedRectangle.value
  return rectangle ? Math.min(3 / viewport.scale, rectangle.width * 0.15, rectangle.height * 0.15) : 0
})
const visibleCurveHandles = computed((): Record<string, Point> | undefined => {
  const rectangle = selectedRectangle.value
  const handles = curveHandles.value
  if (!rectangle || !handles || Math.min(rectangle.width, rectangle.height) * viewport.scale >= 48) return handles
  return rectangle.width >= rectangle.height
    ? {
        northwest: midpoint(handles.northwest, handles.southwest),
        northeast: midpoint(handles.northeast, handles.southeast),
      }
    : {
        northwest: midpoint(handles.northwest, handles.northeast),
        southwest: midpoint(handles.southwest, handles.southeast),
      }
})
const showCurveControls = computed(() =>
  Boolean(!selectedLabel.value && !hasMultipleSelection.value && selectedRectangle.value && !isEllipse(selectedRectangle.value) && !isDiamond(selectedRectangle.value) && !isText(selectedRectangle.value) && isHoveringSelectedShape.value),
)
const rotationHandles = computed<Record<Corner, Point> | undefined>(() => {
  const corners = selectionCorners.value
  const rectangle = selectionFrame.value
  if (!corners || !rectangle) return undefined
  const center = worldToScreen(rectangleCenter(rectangle), viewport)
  return {
    northwest: rotationHandlePoint(worldToScreen(corners.northwest, viewport), center),
    northeast: rotationHandlePoint(worldToScreen(corners.northeast, viewport), center),
    southeast: rotationHandlePoint(worldToScreen(corners.southeast, viewport), center),
    southwest: rotationHandlePoint(worldToScreen(corners.southwest, viewport), center),
  }
})
const isTextSelected = computed(() => Boolean(!hasMultipleSelection.value && (selectedLabel.value || (selectedRectangle.value && isText(selectedRectangle.value)))))
const textLayouts = computed(() => new Map(rectangles.value.filter(isText).map((shape) => [
  shape.id, layoutText(shape.text, shape.width, shape.fontSize, shape.wrap, shape),
])))
const textEditorStyle = computed(() => {
  const editor = textEditor.value
  if (!editor) return undefined
  const origin = editor.original
    ? rotatePoint({ x: editor.x, y: editor.y }, rectangleCenter(editor.original), editor.original.rotation)
    : { x: editor.x, y: editor.y }
  const point = worldToScreen(origin, viewport)
  return {
    left: `${point.x}px`,
    top: `${point.y}px`,
    width: `${editor.width}px`,
    height: `${Math.max(editor.height, editor.fontSize * TEXT_LINE_HEIGHT)}px`,
    fontSize: `${editor.fontSize}px`,
    color: editor.fill ?? 'var(--ink-gray-9, #171717)',
    backgroundColor: editor.backgroundColor ?? 'transparent',
    lineHeight: `${TEXT_LINE_HEIGHT}`,
    fontFamily: TEXT_FONT_FAMILIES[editor.fontFamily ?? 'shantell'],
    fontWeight: editor.fontWeight ?? 400,
    fontStyle: editor.fontStyle ?? 'normal',
    textDecoration: editor.textDecoration ?? 'none',
    textAlign: editor.kind === 'label' ? editor.textAlign ?? 'center' : editor.textAlign ?? 'left',
    transform: `scale(${viewport.scale}) rotate(${editor.original?.rotation ?? 0}deg)`,
    transformOrigin: 'top left',
  }
})
function applyViewport(next: Viewport) {
  if (![next.translationX, next.translationY, next.scale].every(Number.isFinite)) return
  Object.assign(viewport, next)
}

function queueViewport(next: Viewport, announce = false) {
  if (![next.translationX, next.translationY, next.scale].every(Number.isFinite)) {
    cancelGesture()
    return
  }

  pendingViewport = next
  pendingZoomAnnouncement ||= announce
  viewportFrame ??= window.requestAnimationFrame(flushViewport)
}

function flushViewport() {
  viewportFrame = undefined
  if (!pendingViewport) return

  applyViewport(pendingViewport)
  pendingViewport = undefined
  if (pendingZoomAnnouncement) announceZoom()
  pendingZoomAnnouncement = false
}

function copyViewport(viewport: Viewport): Viewport {
  return { ...viewport }
}

function latestViewport(): Viewport {
  return copyViewport(pendingViewport ?? viewport)
}

function center(): Point {
  return { x: size.x / 2, y: size.y / 2 }
}

function announceZoom() {
  window.clearTimeout(announceTimer)
  announceTimer = window.setTimeout(() => {
    liveMessage.value = `Zoom ${Math.round(viewport.scale * 1000) / 10}%`
  }, 180)
}

function setZoom(scale: number, point = center()) {
  queueViewport(zoomAt(latestViewport(), point, scale), true)
}

function stepZoom(direction: -1 | 1) {
  setZoom(nextZoomStep(latestViewport().scale, direction))
}

function resetZoom() {
  setZoom(1)
}

function panToMinimapPoint(point: Point) {
  const current = latestViewport()
  queueViewport({
    ...current,
    translationX: size.x / 2 - point.x * current.scale,
    translationY: size.y / 2 - point.y * current.scale,
  })
}

function copyScene(scene: SceneSnapshot = { rectangles: rectangles.value, lines: lines.value }): SceneSnapshot {
  return {
    rectangles: scene.rectangles.map((rectangle) => isFreeDraw(rectangle) ? { ...rectangle, points: rectangle.points.map(point => ({ ...point })), pressures: [...rectangle.pressures] } : { ...rectangle }),
    lines: scene.lines.map((line) => ({ ...line, start: { ...line.start }, end: { ...line.end } })),
  }
}

function scenesMatch(left: SceneSnapshot, right: SceneSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function commitScene(previousSelection = selectedShapeIds.value) {
  let order = Math.max(0, ...allShapes.value.map(s => s.order ?? 0))
  for (const shape of allShapes.value) if (shape.order === undefined) shape.order = ++order
  const next = copyScene()
  if (scenesMatch(history[historyIndex], next)) return
  const previousIds = new Set([...history[historyIndex]!.rectangles, ...history[historyIndex]!.lines].map(s => s.id))
  const surviving = previousSelection.filter(id => previousIds.has(id))
  if (surviving.length) historySelections[historyIndex] = surviving
  historySelections.splice(historyIndex + 1)
  historySelections.push([...selectedShapeIds.value])
  history.splice(historyIndex + 1)
  history.push(next)
  // ponytail: keep recent undo only; use compressed history if 100 entries is too short.
  if (history.length > MAX_HISTORY_ENTRIES) {
    history.shift()
    historySelections.shift()
  }
  historyIndex = history.length - 1
  historyVersion.value += 1
  queueSave(next)
}

function restoreScene(index: number) {
  const scene = copyScene(history[index])
  rectangles.value = scene.rectangles
  lines.value = scene.lines
  const available = new Set([...scene.rectangles, ...scene.lines].map(s => s.id))
  const surviving = selectedShapeIds.value.filter(id => available.has(id))
  setSelection(surviving.length ? surviving : (historySelections[index] ?? []).filter(id => available.has(id)))
  hoveredSelectionHandle.value = undefined
  isHoveringSelectedShape.value = false
  isMoveReady.value = false
  clearSnapFeedback()
  queueSave(scene)
}

function undoScene() {
  cancelGesture()
  if (historyIndex === 0) return
  historyIndex -= 1
  historyVersion.value += 1
  restoreScene(historyIndex)
}

function redoScene() {
  cancelGesture()
  if (historyIndex === history.length - 1) return
  historyIndex += 1
  historyVersion.value += 1
  restoreScene(historyIndex)
}

function deleteSelectedShape(): boolean {
  if (selectedLabel.value) {
    updateLabel(selectedLabel.value.id, undefined)
    return true
  }
  return deleteShapes([...selectedShapeIds.value])
}

function deleteShapes(ids: string[]): boolean {
  if (!ids.length) return false
  const previousSelection = [...selectedShapeIds.value]
  rectangles.value = rectangles.value.filter(shape => !ids.includes(shape.id))
  lines.value = lines.value.filter(shape => !ids.includes(shape.id))
  setSelection(selectedShapeIds.value.filter(id => !ids.includes(id)))
  commitScene(previousSelection.length ? previousSelection : ids)
  return true
}

function clearSelection() {
  setSelection([])
}

function selectShape(shape: RectangleShape | LineShape, append = false): boolean {
  const ids = shape.groupId && shape.groupId !== enteredGroup.value
    ? allShapes.value.filter(candidate => candidate.groupId === shape.groupId).map(candidate => candidate.id)
    : [shape.id]
  const wasSelected = ids.every(id => selectedShapeIds.value.includes(id))
  setSelection(append
    ? wasSelected ? selectedShapeIds.value.filter(id => !ids.includes(id)) : [...new Set([...selectedShapeIds.value, ...ids])]
    : ids)
  return !(append && wasSelected)
}

function selectLabel(shape: RectangleShape) {
  setSelection([shape.id])
  selectedLabelId.value = shape.id
  liveMessage.value = 'Text selected'
}

function groupSelectedShapes(): boolean {
  if (selectedShapeIds.value.length < 2) return false
  const groupId = nextGroupId()
  rectangles.value = rectangles.value.map((shape) =>
    selectedShapeIds.value.includes(shape.id) ? { ...shape, groupId } : shape,
  )
  lines.value = lines.value.map((shape) =>
    selectedShapeIds.value.includes(shape.id) ? { ...shape, groupId } : shape,
  )
  commitScene()
  return true
}

function setSelection(ids: string[]) {
  const available = new Set(allShapes.value.map(shape => shape.id))
  const selected = [...new Set(ids)].filter(id => available.has(id))
  selectedLabelId.value = undefined
  selectedShapeIds.value = selected
  multiSelectionFrame.value = selected.length > 1 ? selectionOutline(bounds(allShapes.value.filter(shape => selected.includes(shape.id)))!) : undefined
  selectedRectangleId.value = rectangles.value.find(s => s.id === selected.at(-1))?.id
  selectedLineId.value = lines.value.find(s => s.id === selected.at(-1))?.id
  liveMessage.value = `${selected.length} objects selected`
}

function selectionScene(): SceneSnapshot {
  return copyScene({ rectangles: rectangles.value.filter(s => selectedShapeIds.value.includes(s.id)), lines: lines.value.filter(s => selectedShapeIds.value.includes(s.id)) })
}
function copySelectedShape(): boolean {
  if (!selectedShapeIds.value.length) return false
  clipboard = selectionScene()
  return true
}
function insertScene(scene: SceneSnapshot, offset = 10, commit = true) {
  const groups = new Map<string, string>()
  let order = Math.max(0, ...allShapes.value.map(shape => shape.order ?? 0))
  const clone = (shape: Shape): Shape => {
    const groupId = shape.groupId ? groups.get(shape.groupId) ?? nextGroupId() : undefined
    if (shape.groupId && groupId) groups.set(shape.groupId, groupId)
    return isLine(shape)
      ? { ...shape, id: nextId('line'), order: ++order, groupId, start: { x: shape.start.x + offset, y: shape.start.y + offset }, end: { x: shape.end.x + offset, y: shape.end.y + offset } }
      : { ...shape, id: nextId('rectangle'), order: ++order, groupId, x: shape.x + offset, y: shape.y + offset }
  }
  const shapes = [...scene.lines, ...scene.rectangles].sort((a,b) => (a.order ?? 0) - (b.order ?? 0)).map(clone)
  lines.value.push(...shapes.filter(isLine))
  rectangles.value.push(...shapes.filter((s): s is RectangleShape => !isLine(s)))
  setSelection(shapes.map(s => s.id))
  if (commit) commitScene()
}
function duplicateSelection(offset = 10, commit = true) {
  if (selectedShapeIds.value.length) insertScene(selectionScene(), offset, commit)
}
function readImage(file: File): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image.'))
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : ''
      const image = new Image()
      image.onerror = () => reject(new Error('Could not decode image.'))
      image.onload = () => resolve({ src, width: image.naturalWidth, height: image.naturalHeight })
      image.src = src
    }
    reader.readAsDataURL(file)
  })
}
function imageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Could not decode image.'))
    image.src = src
  })
}
function sourceCrop(image: ImageShape) {
  return image.crop ?? { x: 0, y: 0, width: image.naturalWidth!, height: image.naturalHeight! }
}
function cropSourceBounds(image: ImageShape) {
  const crop = sourceCrop(image)
  return {
    x: image.x - (crop.x / crop.width) * image.width,
    y: image.y - (crop.y / crop.height) * image.height,
    width: image.width / crop.width * image.naturalWidth!,
    height: image.height / crop.height * image.naturalHeight!,
  }
}
function cropPoint(image: ImageShape, point: Point): Point {
  const local = rotatePoint(screenToWorld(point, latestViewport()), rectangleCenter(image), -image.rotation)
  const bounds = cropSourceBounds(image)
  return { x: Math.max(bounds.x, Math.min(bounds.x + bounds.width, local.x)), y: Math.max(bounds.y, Math.min(bounds.y + bounds.height, local.y)) }
}
async function beginCrop() {
  let image = selectedShapes.value.length === 1 && isImage(selectedShapes.value[0]!) ? selectedShapes.value[0] : undefined
  if (!image) return
  if (!image.naturalWidth || !image.naturalHeight) {
    try {
      const dimensions = await imageDimensions(image.src)
      image = { ...image, naturalWidth: dimensions.width, naturalHeight: dimensions.height }
      replaceRectangle(image)
    } catch { liveMessage.value = 'Could not prepare image for cropping.'; return }
  }
  croppingImageId.value = image.id
  cropFrame.value = { ...image, id: 'crop', rotation: 0, cornerRadius: 0 }
  liveMessage.value = 'Drag over the image to keep an area. Press Escape to cancel.'
}
function beginCropSelection(event: PointerEvent, point: Point): boolean {
  const image = croppingImage.value
  if (!image) return false
  const start = cropPoint(image, point)
  const bounds = cropSourceBounds(image)
  if (start.x <= bounds.x || start.x >= bounds.x + bounds.width || start.y <= bounds.y || start.y >= bounds.y + bounds.height) {
    cancelCrop()
    return true
  }
  cropGesture = { pointerId: event.pointerId, start }
  cropFrame.value = rectangleFromPoints(start, start, 'crop')
  root.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
  return true
}
function updateCropSelection(point: Point) {
  const image = croppingImage.value
  if (!image || !cropGesture) return
  cropFrame.value = rectangleFromPoints(cropGesture.start, cropPoint(image, point), 'crop')
}
function finishCrop(event: PointerEvent): boolean {
  const image = croppingImage.value
  const frame = cropFrame.value
  if (!image || !frame || cropGesture?.pointerId !== event.pointerId) return false
  if (frame.width * viewport.scale >= 4 && frame.height * viewport.scale >= 4) {
    const bounds = cropSourceBounds(image)
    replaceRectangle({
      ...image,
      crop: {
        x: (frame.x - bounds.x) / bounds.width * image.naturalWidth!,
        y: (frame.y - bounds.y) / bounds.height * image.naturalHeight!,
        width: frame.width / bounds.width * image.naturalWidth!,
        height: frame.height / bounds.height * image.naturalHeight!,
      },
    } as ImageShape)
    commitScene()
  }
  cropGesture = undefined
  cropFrame.value = undefined
  croppingImageId.value = undefined
  releasePointer(event.pointerId)
  return true
}
function cancelCrop() {
  if (cropGesture) releasePointer(cropGesture.pointerId)
  cropGesture = undefined
  cropFrame.value = undefined
  croppingImageId.value = undefined
}
function cropMaskPath(image: ImageShape, frame: RectangleShape) {
  const bounds = cropSourceBounds(image)
  return `M${bounds.x} ${bounds.y}h${bounds.width}v${bounds.height}h-${bounds.width}zM${frame.x} ${frame.y}h${frame.width}v${frame.height}h-${frame.width}z`
}
async function insertImages(files: Iterable<File>, point = center()) {
  const imageFiles = [...files].filter(file => IMAGE_TYPES.has(file.type) && file.size <= MAX_IMAGE_BYTES)
  if (!imageFiles.length) { liveMessage.value = 'Use a PNG, JPEG, GIF, or WebP image up to 10 MB.'; return }
  const start = screenToWorld(point, latestViewport())
  const added: ImageShape[] = []
  for (const [index, file] of imageFiles.entries()) {
    try {
      const image = await readImage(file)
      const scale = Math.min(1, 480 / Math.max(image.width, image.height))
      const width = Math.max(24, Math.round(image.width * scale))
      const height = Math.max(24, Math.round(image.height * scale))
      added.push({ id: nextId('image'), kind: 'image', src: image.src, naturalWidth: image.width, naturalHeight: image.height, x: start.x + index * 16, y: start.y + index * 16, width, height, rotation: 0, cornerRadius: 0, stroke: null })
    } catch { liveMessage.value = `Could not add ${file.name}.` }
  }
  if (!added.length) return
  rectangles.value.push(...added)
  setSelection(added.map(image => image.id))
  commitScene()
  liveMessage.value = `${added.length} image${added.length === 1 ? '' : 's'} added`
  if (props.activeTool === 'image') emit('cancelTool')
}
function openImagePicker(point = center()) { imageInsertPoint = point; fileInput.value?.click() }
function onImageInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) void insertImages(input.files, imageInsertPoint)
  imageInsertPoint = undefined
  input.value = ''
}
function onDragOver(event: DragEvent) {
  if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
}
function onDrop(event: DragEvent) {
  const files = event.dataTransfer?.files
  if (!files?.length) return
  event.preventDefault()
  void insertImages(files, localPoint(event))
}
function onClipboard(event: ClipboardEvent) {
  if (drawingLoading.value || editableTarget(event.target)) return
  if (event.type === 'paste') {
    const imageFiles = [...(event.clipboardData?.items ?? [])]
      .filter(item => IMAGE_TYPES.has(item.type))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (imageFiles.length) {
      event.preventDefault()
      void insertImages(imageFiles)
      return
    }
    try {
      const data = JSON.parse(event.clipboardData?.getData('text/plain') ?? '')
      if (data.format !== 'draw') return
      insertScene(parseScene(data.scene))
      event.preventDefault()
    } catch { liveMessage.value = 'Clipboard does not contain a valid Draw drawing.' }
  } else if (copySelectedShape()) {
    event.clipboardData?.setData('text/plain', JSON.stringify({ format: 'draw', scene: clipboard }))
    event.preventDefault()
    if (event.type === 'cut' && event.clipboardData) deleteSelectedShape()
  }
}
function ungroupSelection() {
  for (const shape of selectedShapes.value) delete shape.groupId
  enteredGroup.value = undefined
  commitScene()
}

function shapeLabel(shape: Shape) {
  return isLine(shape) ? (shape.kind === 'arrow' ? 'Arrow' : 'Line') : isFreeDraw(shape) ? 'Drawing' : isImage(shape) ? 'Image' : isText(shape) ? shape.text : shape.label || (isDiamond(shape) ? 'Diamond' : isEllipse(shape) ? 'Ellipse' : 'Rectangle')
}

function textX(shape: TextShape): number {
  if (shape.textAlign === 'center') return shape.x + shape.width / 2
  if (shape.textAlign === 'right') return shape.x + shape.width
  return shape.x
}

function cyclePropertyTextAlign() {
  if (!textPropertyControlsEnabled.value) return
  const index = textAlignOptions.findIndex(option => option.value === propertyTextStyle.value.textAlign)
  updatePropertyTextStyle({ textAlign: textAlignOptions[(index + 1) % textAlignOptions.length]!.value })
}

function constrainDelta(delta: Point): Point {
  return isShiftPressed.value ? Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y } : delta
}

function moveSelectedShape(x: number, y: number): boolean {
  if (!selectedShapeIds.value.length) return false
  moveSelectedShapes(copyScene(), { x, y })
  commitScene()
  return true
}

function moveSelectedShapes(scene: SceneSnapshot, delta: Point) {
  rectangles.value = rectangles.value.map((shape) => {
    const original = scene.rectangles.find((candidate) => candidate.id === shape.id)
    if (!original || !selectedShapeIds.value.includes(shape.id)) return shape
    const moved = moveRectangle(original, delta)
    return isFreeDraw(original)
      ? { ...original, ...moved, points: original.points.map(point => ({ x: point.x + delta.x, y: point.y + delta.y })) }
      : moved
  })
  lines.value = lines.value.map((shape) => {
    const original = scene.lines.find((candidate) => candidate.id === shape.id)
    return original && selectedShapeIds.value.includes(shape.id) ? moveLine(original, delta) : shape
  })
}

function localPoint(event: MouseEvent | WheelEvent | DragEvent): Point {
  const bounds = root.value?.getBoundingClientRect()
  return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
}

function autoPan(point: Point) {
  const x = edgePanDelta(point.x, size.x)
  const y = edgePanDelta(point.y, size.y)
  if (x === 0 && y === 0) return
  const current = latestViewport()
  queueViewport({ ...current, translationX: current.translationX + x, translationY: current.translationY + y })
}

function edgePanDelta(value: number, maximum: number): number {
  if (value < AUTO_PAN_EDGE) return Math.min(AUTO_PAN_SPEED, AUTO_PAN_EDGE - value)
  if (value > maximum - AUTO_PAN_EDGE) return -Math.min(AUTO_PAN_SPEED, value - (maximum - AUTO_PAN_EDGE))
  return 0
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function centroid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function beginPinch() {
  const [a, b] = [...pointers.values()]
  if (!a || !b) return
  const nextDistance = distance(a, b)
  if (nextDistance <= 0) return
  laserPointerId = undefined
  laserTrail.value?.clear()
  singlePointerStart = undefined
  isPanning.value = true
  pinchStart = {
    distance: nextDistance,
    centroid: centroid(a, b),
    viewport: latestViewport(),
  }
}

function startTextEditor(editor: TextEditor) {
  clearSelection()
  hoveredSelectionHandle.value = undefined
  isMoveReady.value = false
  textEditor.value = editor
  nextTick(() => {
    textArea.value?.focus({ preventScroll: true })
    if (editor.shapeId && textArea.value) {
      if (editor.kind === 'text') textArea.value.select()
      else textArea.value.setSelectionRange(editor.text.length, editor.text.length)
      textArea.value.scrollLeft = 0
      textArea.value.scrollTop = 0
    }
  })
}

function beginText(event: PointerEvent, point: Point) {
  if (textGesture) return
  const start = screenToWorld(point, latestViewport())
  const hit = [...rectangles.value].reverse().find((shape) => containsPoint(shape, start))
  if (hit) {
    if (isImage(hit)) { selectShape(hit); emit('cancelTool'); event.preventDefault(); return }
    isText(hit) ? editText(hit) : editLabel(hit)
    emit('cancelTool')
    event.preventDefault()
    return
  }
  clearSelection()
  textGesture = { pointerId: event.pointerId, start }
  root.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function updateText(event: PointerEvent) {
  if (!textGesture) return
  const end = screenToWorld(localPoint(event), latestViewport())
  textGesture.end = end
  if (distance(textGesture.start, end) * latestViewport().scale < 4) {
    pendingText.value = undefined
    return
  }
  const draft = rectangleFromPoints(textGesture.start, end, 'pending-text')
  pendingText.value = { ...draft, width: Math.max(24, draft.width), height: 20 }
}

function finishText(event: PointerEvent) {
  if (!textGesture || textGesture.pointerId !== event.pointerId) return false
  const start = textGesture.start
  if (event.type === 'pointerup') updateText(event)
  const end = textGesture.end ?? start
  const dragged = distance(start, end) * latestViewport().scale >= 4
  const draft = pendingText.value
  startTextEditor({
    kind: 'text',
    text: '',
    x: dragged ? draft?.x ?? start.x : start.x,
    y: dragged ? draft?.y ?? start.y : start.y - 10,
    width: dragged ? Math.max(24, draft?.width ?? Math.abs(end.x - start.x)) : 16,
    height: 20,
    fill: armedTextStyle.fill,
    backgroundColor: armedTextStyle.backgroundColor,
    fontSize: armedTextStyle.fontSize,
    fontFamily: armedTextStyle.fontFamily,
    wrap: dragged,
  })
  pendingText.value = undefined
  textGesture = undefined
  releasePointer(event.pointerId)
  emit('cancelTool')
  return true
}

function editText(shape: TextShape) {
  startTextEditor({
    kind: 'text',
    shapeId: shape.id,
    text: shape.text,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    fill: shape.fill,
    backgroundColor: shape.backgroundColor,
    fontSize: shape.fontSize,
    wrap: shape.wrap,
    fontFamily: shape.fontFamily,
    fontWeight: shape.fontWeight,
    fontStyle: shape.fontStyle,
    textDecoration: shape.textDecoration,
    textAlign: shape.textAlign,
    original: { ...shape },
  })
}

function editLabel(shape: RectangleShape) {
  const fitted = fitLabel(shape, shape.label ?? '', shape.labelFontSize ?? 16, shape.labelFontFamily ?? 'shantell')
  startTextEditor({
    kind: 'label',
    shapeId: shape.id,
    text: shape.label ?? '',
    x: labelTextX(fitted.shape),
    y: fitted.shape.y + (fitted.shape.height - fitted.layout.height) / 2,
    width: labelTextWidth(fitted.shape),
    height: fitted.layout.height,
    fill: shape.labelFill ?? '#171717',
    fontSize: shape.labelFontSize ?? 16,
    fontFamily: shape.labelFontFamily ?? 'shantell',
    fontWeight: shape.labelFontWeight,
    fontStyle: shape.labelFontStyle,
    textDecoration: shape.labelTextDecoration,
    textAlign: shape.labelTextAlign ?? 'center',
    wrap: true,
    original: { ...shape },
  })
}

function updateTextEditor(event: Event) {
  const editor = textEditor.value
  const input = event.target as HTMLTextAreaElement
  if (!editor) return
  editor.text = input.value
  if (editor.kind === 'label' && editor.shapeId) {
    const shape = rectangles.value.find((candidate) => candidate.id === editor.shapeId)
    if (!shape || isText(shape)) return
    const fitted = fitLabel(shape, editor.text, editor.fontSize, editor.fontFamily, editor)
    replaceRectangle({ ...fitted.shape, label: editor.text || undefined, labelFontSize: editor.fontSize, labelFontFamily: editor.fontFamily, labelFill: editor.fill, labelFontWeight: editor.fontWeight, labelFontStyle: editor.fontStyle, labelTextDecoration: editor.textDecoration, labelTextAlign: editor.textAlign })
    editor.x = labelTextX(fitted.shape)
    editor.y = fitted.shape.y + (fitted.shape.height - fitted.layout.height) / 2
    editor.width = labelTextWidth(fitted.shape)
    editor.height = fitted.layout.height
    return
  }
  const layout = layoutText(editor.text, editor.width, editor.fontSize, editor.wrap, editor)
  editor.width = editor.wrap ? editor.width : layout.width
  editor.height = layout.height
}

function updatePropertyTextStyle(patch: TextStylePatch) {
  if (!textPropertyControlsEnabled.value) return
  const editor = textEditor.value
  if (!editor) {
    if (selectedTextShapes.value.length) {
      updateSelectedTextStyle(patch)
      return
    }
    if (selectedLabel.value) {
      const shape = selectedLabel.value
      rectangles.value = rectangles.value.map(candidate => {
        if (candidate.id !== shape.id) return candidate
        const styled = {
          ...candidate,
          ...('fill' in patch ? { labelFill: patch.fill } : {}),
          ...(patch.fontFamily !== undefined ? { labelFontFamily: patch.fontFamily } : {}),
          ...(patch.fontSize !== undefined ? { labelFontSize: patch.fontSize } : {}),
          ...(patch.fontWeight !== undefined ? { labelFontWeight: patch.fontWeight } : {}),
          ...(patch.fontStyle !== undefined ? { labelFontStyle: patch.fontStyle } : {}),
          ...(patch.textDecoration !== undefined ? { labelTextDecoration: patch.textDecoration } : {}),
          ...(patch.textAlign !== undefined ? { labelTextAlign: patch.textAlign } : {}),
        }
        return fitLabel(styled, styled.label ?? '', styled.labelFontSize, styled.labelFontFamily, styled).shape
      })
      commitScene()
      return
    }
    Object.assign(armedTextStyle, patch)
    return
  }
  Object.assign(editor, patch)
  if (editor.kind === 'label' && editor.shapeId) {
    const shape = rectangles.value.find((candidate) => candidate.id === editor.shapeId)
    if (!shape || isText(shape)) return
    const fitted = fitLabel(shape, editor.text, editor.fontSize, editor.fontFamily, editor)
    replaceRectangle({ ...fitted.shape, label: editor.text || undefined, labelFontSize: editor.fontSize, labelFontFamily: editor.fontFamily, labelFill: editor.fill, labelFontWeight: editor.fontWeight, labelFontStyle: editor.fontStyle, labelTextDecoration: editor.textDecoration, labelTextAlign: editor.textAlign })
    editor.x = labelTextX(fitted.shape)
    editor.y = fitted.shape.y + (fitted.shape.height - fitted.layout.height) / 2
    editor.width = labelTextWidth(fitted.shape)
    editor.height = fitted.layout.height
    return
  }
  const layout = layoutText(editor.text, editor.width, editor.fontSize, editor.wrap, editor)
  editor.width = editor.wrap ? editor.width : layout.width
  editor.height = layout.height
}

function finishTextEditor(event?: FocusEvent) {
  if (propertyToolbarInteracting.value) return
  const nextTarget = event?.relatedTarget
  if (nextTarget instanceof HTMLElement && nextTarget.closest('.property-toolbar')) return
  const editor = textEditor.value
  if (!editor) return
  textEditor.value = undefined
  if (props.activeTool === 'text') emit('cancelTool')
  if (!editor.text.trim()) {
    if (editor.kind === 'label' && editor.shapeId) {
      updateLabel(editor.shapeId, undefined)
      return
    }
    if (editor.shapeId) {
      rectangles.value = rectangles.value.filter((shape) => shape.id !== editor.shapeId)
      clearSelection()
      commitScene()
    }
    return
  }
  if (editor.kind === 'label' && editor.shapeId) {
    updateLabel(editor.shapeId, editor.text)
    return
  }
  const layout = layoutText(editor.text, editor.width, editor.fontSize, editor.wrap, editor)
  const shape: TextShape = {
    ...fitTextBounds(editor.original ?? {
      id: '', x: editor.x, y: editor.y, width: editor.width, height: editor.height,
      rotation: 0, cornerRadius: 0,
    }, layout.width, layout.height),
    id: editor.shapeId ?? nextId('text'),
    kind: 'text',
    text: editor.text,
    fontSize: editor.fontSize,
    wrap: editor.wrap,
    fill: editor.fill,
    backgroundColor: editor.backgroundColor,
    fontFamily: editor.fontFamily ?? 'shantell',
    fontWeight: editor.fontWeight,
    fontStyle: editor.fontStyle,
    textDecoration: editor.textDecoration,
    textAlign: editor.textAlign,
    rotation: editor.original?.rotation ?? 0,
    cornerRadius: editor.original?.cornerRadius ?? 0,
  }
  if (editor.shapeId) replaceRectangle(shape)
  else rectangles.value.push(shape)
  selectShape(shape)
  if (!editor.shapeId) window.setTimeout(() => selectShape(shape), 0)
  commitScene()
}

function beginPropertyToolbarInteraction() {
  propertyToolbarInteracting.value = true
}

function endPropertyToolbarInteraction() {
  propertyToolbarInteracting.value = false
}

function updateLabel(id: string, label: string | undefined) {
  const shape = rectangles.value.find((candidate) => candidate.id === id)
  if (!shape || isText(shape)) return
  replaceRectangle({ ...fitLabel(shape, label ?? '').shape, label, labelFontSize: shape.labelFontSize ?? 16 })
  selectShape(shape)
  commitScene()
}

function beginRectangle(event: PointerEvent, point: Point) {
  const start = screenToWorld(point, latestViewport())
  rectangleGesture = { pointerId: event.pointerId, start }
  creationLast = start
  modifiers.alt = event.altKey
  latestGesturePoint.value = point
  pendingRectangle.value = shapeFromPoints(start, start, 'pending')
  root.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function updateRectangle(point: Point) {
  if (!rectangleGesture) return
  const end = screenToWorld(point, latestViewport())
  if (isSpacePressed.value && creationLast) {
    rectangleGesture.start.x += end.x - creationLast.x
    rectangleGesture.start.y += end.y - creationLast.y
  }
  creationLast = end
  pendingRectangle.value = shapeFromPoints(
    rectangleGesture.start,
    screenToWorld(point, latestViewport()),
    'pending', isShiftPressed.value,
  )
  if (modifiers.alt && pendingRectangle.value) {
    const p = pendingRectangle.value, c = rectangleGesture.start
    pendingRectangle.value = { ...p, x: c.x - p.width, y: c.y - p.height, width: p.width * 2, height: p.height * 2 }
  }
}

function finishRectangle(event: PointerEvent) {
  if (!rectangleGesture || rectangleGesture.pointerId !== event.pointerId) return false
  const rectangle = pendingRectangle.value
  if (rectangle && rectangle.width > 0 && rectangle.height > 0) {
    const isEllipseShape = isEllipse(rectangle)
    const isDiamondShape = isDiamond(rectangle)
    const committed = {
      ...rectangle,
      id: nextId(isDiamondShape ? 'diamond' : isEllipseShape ? 'ellipse' : 'rectangle'),
    }
    rectangles.value.push(committed)
    selectShape(committed)
    commitScene()
    if (isDiamondShape) emit('diamondCreated')
    else if (isEllipseShape) emit('ellipseCreated')
    else emit('rectangleCreated')
  }
  pendingRectangle.value = undefined
  rectangleGesture = undefined
  latestGesturePoint.value = undefined
  releasePointer(event.pointerId)
  return true
}

function lineToolKind(): LineShape['kind'] {
  return props.activeTool === 'arrow' ? 'arrow' : 'line'
}

function beginLine(event: PointerEvent, point: Point) {
  const start = screenToWorld(point, latestViewport())
  lineGesture = { pointerId: event.pointerId, start }
  creationLast = start
  modifiers.alt = event.altKey
  latestGesturePoint.value = point
  pendingLine.value = lineFromPoints(start, start, 'pending', false, lineToolKind())
  root.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function updateLine(point: Point) {
  if (!lineGesture) return
  const end = screenToWorld(point, latestViewport())
  if (isSpacePressed.value && creationLast) {
    lineGesture.start.x += end.x - creationLast.x
    lineGesture.start.y += end.y - creationLast.y
  }
  creationLast = end
  pendingLine.value = lineFromPoints(
    lineGesture.start,
    screenToWorld(point, latestViewport()),
    'pending',
    isShiftPressed.value,
    lineToolKind(),
  )
  if (modifiers.alt && pendingLine.value) pendingLine.value.start = { x: 2 * lineGesture.start.x - pendingLine.value.end.x, y: 2 * lineGesture.start.y - pendingLine.value.end.y }
}

function finishLine(event: PointerEvent) {
  if (!lineGesture || lineGesture.pointerId !== event.pointerId) return false
  const line = pendingLine.value
  if (line && distance(line.start, line.end) > 0) {
    const committed = { ...line, id: nextId(line.kind) }
    lines.value.push(committed)
    selectShape(committed)
    commitScene()
    emit('lineCreated')
  }
  pendingLine.value = undefined
  lineGesture = undefined
  latestGesturePoint.value = undefined
  clearSnapFeedback()
  releasePointer(event.pointerId)
  return true
}

function startSelection(event: PointerEvent, point: Point) {
  clearSnapFeedback()
  isMoveReady.value = false
  latestGesturePoint.value = point
  const worldPoint = screenToWorld(point, latestViewport())
  const handle = selectionHandleAt(point)
  const rectangleHandle = handle === 'line-curve' ? undefined : handle
  const rectangle = hasMultipleSelection.value || selectedLabel.value ? selectionFrame.value : selectedRectangle.value
  const line = selectedLine.value
  const lineHandle = hasMultipleSelection.value ? undefined : lineSelectionHandleAt(point)
  cycleClickPoint = (event.metaKey || event.ctrlKey) && !handle ? point : undefined
  cycleClickShape = undefined
  if (cycleClickPoint) {
    const hits = [...allShapes.value].reverse().filter(s => isLine(s) ? containsLine(s, point) : containsPoint(s, worldPoint))
    cycleClickShape = hits[(hits.findIndex(s => selectedShapeIds.value.includes(s.id)) + 1) % hits.length]
  }
  shiftClickShape = undefined
  if (event.shiftKey && !rectangleHandle && !lineHandle) {
    const hit = [...allShapes.value].reverse().find(s => isLine(s) ? containsLine(s, point) : containsPoint(s, worldPoint))
    if (hit && selectedShapeIds.value.includes(hit.id)) shiftClickShape = hit
    else if (hit) selectShape(hit, true)
  }
  if (line && lineHandle) {
    isCurving.value = lineHandle === 'curve'
    lineSelectionGesture = {
      pointerId: event.pointerId,
      kind: lineHandle,
      start: worldPoint,
      original: copyLine(line),
      originalScene: copyScene(),
    }
  } else if (rectangle && rectangleHandle) {
    hoveredSelectionHandle.value = rectangleHandle
    selectionGesture = {
      pointerId: event.pointerId,
      kind: isRotateHandle(rectangleHandle) ? 'rotate' : isCurveHandle(rectangleHandle) ? 'curve' : 'resize',
      handle: isRotateHandle(rectangleHandle) ? undefined : isCurveHandle(rectangleHandle) ? curveCorner(rectangleHandle) : rectangleHandle,
      start: worldPoint,
      original: { ...rectangle },
      initial: { ...rectangle },
      originalScene: copyScene(),
      labelOriginal: selectedLabel.value ? { ...selectedLabel.value } : undefined,
      handleStart: isRotateHandle(rectangleHandle) || isCurveHandle(rectangleHandle) ? undefined : resizeHandlePoint(rectangle, rectangleHandle),
    }
    isRotating.value = isRotateHandle(rectangleHandle)
  } else {
    const topHit = [...allShapes.value].reverse().find(s => isLine(s) ? containsLine(s, point) : containsPoint(s, worldPoint))
    const hit = topHit && !isLine(topHit) ? topHit : undefined
    isHoveringSelectedShape.value = Boolean(hit)
    if (hit) {
      const labelHit = !event.shiftKey && !event.metaKey && !event.ctrlKey && !isText(hit) && !isImage(hit) && !isFreeDraw(hit) && Boolean(hit.label) && (!hit.groupId || hit.groupId === enteredGroup.value) && containsLabelPoint(hit, worldPoint)
      if (labelHit) selectLabel(hit)
      else selectedLabelId.value = undefined
      if (!selectedShapeIds.value.includes(hit.id) && !selectShape(hit, event.shiftKey)) return
      selectionGesture = {
        pointerId: event.pointerId,
        kind: 'move',
        start: worldPoint,
        original: { ...(hasMultipleSelection.value ? selectionFrame.value! : hit) },
        initial: { ...hit },
        originalScene: copyScene(),
      }
    } else {
      if (hasMultipleSelection.value && selectionFrame.value && containsPoint(selectionFrame.value, worldPoint)) {
        selectionGesture = {
          pointerId: event.pointerId,
          kind: 'move',
          start: worldPoint,
          original: { ...selectionFrame.value },
          initial: { ...selectionFrame.value },
          originalScene: copyScene(),
        }
      } else {
        const lineHit = topHit && isLine(topHit) ? topHit : undefined
        if (lineHit) {
          if (!selectedShapeIds.value.includes(lineHit.id) && !selectShape(lineHit, event.shiftKey)) return
          lineSelectionGesture = {
            pointerId: event.pointerId,
            kind: 'move',
            start: worldPoint,
            original: copyLine(lineHit),
            originalScene: copyScene(),
          }
        } else {
          marqueeGesture = { pointerId: event.pointerId, start: worldPoint, previous: event.shiftKey ? [...selectedShapeIds.value] : [] }
          root.value?.setPointerCapture(event.pointerId)
          if (!event.shiftKey) clearSelection()
        }
      }
    }
  }

  if (hasMultipleSelection.value && lineSelectionGesture?.kind === 'move' && selectionFrame.value) {
    selectionGesture = { pointerId: event.pointerId, kind: 'move', start: worldPoint, original: { ...selectionFrame.value }, initial: { ...selectionFrame.value }, originalScene: copyScene() }
    lineSelectionGesture = undefined
    isCurving.value = false
  }
  duplicateOnDrag = event.altKey && (selectionGesture?.kind === 'move' || lineSelectionGesture?.kind === 'move')
  if (!selectionGesture && !lineSelectionGesture) return
  root.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function updateSelection(point: Point, constrainProportions = isShiftPressed.value) {
  const gesture = selectionGesture ?? lineSelectionGesture
  if (gesture?.kind === 'move') {
    if (distance(screenToWorld(point, latestViewport()), gesture.start) * viewport.scale < 3) return
    shiftClickShape = undefined
    cycleClickPoint = undefined
    if (duplicateOnDrag) {
      const rollback = copyScene()
      duplicateSelection(0, false)
      gesture.rollbackScene = rollback
      gesture.originalScene = copyScene()
      duplicateOnDrag = false
    }
  }
  if (lineSelectionGesture) {
    updateLineSelection(point)
    return
  }
  if (!selectionGesture) return
  const pointer = screenToWorld(point, latestViewport())
  const { original } = selectionGesture
  if (isText(original) && !selectionGesture.dragStarted) {
    if (distance(pointer, selectionGesture.start) * latestViewport().scale < TEXT_DRAG_THRESHOLD) return
    selectionGesture.dragStarted = true
    selectionGesture.start = pointer
    return
  }
  // ponytail: rotated/text groups keep proportions; affine geometry is needed for skew.
  constrainProportions ||= selectionGesture.kind === 'resize' && hasMultipleSelection.value && selectedShapes.value.some(s => !isLine(s) && (s.rotation % 90 !== 0 || isText(s)))
  const textCornerResize = Boolean(
    (isText(original) || selectionGesture.labelOriginal) && selectionGesture.kind === 'resize' && selectionGesture.handle && isCorner(selectionGesture.handle),
  )
  const moved = moveRectangle(original, constrainDelta({
    x: pointer.x - selectionGesture.start.x,
    y: pointer.y - selectionGesture.start.y,
  }))
  const moveSnap = selectionGesture.kind === 'move' && !modifiers.bypass && !isShiftPressed.value
    ? snapShapeMove(moved, rectangles.value.filter(s => !selectedShapeIds.value.includes(s.id)), viewport.scale)
    : undefined
  const resizeSnap = selectionGesture.kind === 'resize' && selectionGesture.handle && !constrainProportions && !textCornerResize && !modifiers.bypass && !modifiers.alt
    ? snapResizeHandlePoint(
        resizePointer(pointer),
        original,
        selectionGesture.handle,
        rectangles.value.filter(s => !selectedShapeIds.value.includes(s.id)),
        viewport.scale,
      )
    : undefined
  if (moveSnap) {
    alignmentGuides.value = moveSnap.alignmentGuides
    spacingMarkers.value = moveSnap.spacingMarkers
  } else if (resizeSnap) {
    alignmentGuides.value = resizeSnap.alignmentGuides
    spacingMarkers.value = []
  } else {
    clearShapeSnapFeedback()
  }
  let next =
    selectionGesture.kind === 'move'
      ? moveSnap?.shape ?? moved
      : selectionGesture.kind === 'resize' && selectionGesture.handle
        ? isCorner(selectionGesture.handle)
          ? resizeFromCorner(
              original,
              selectionGesture.handle,
              resizeSnap?.point ?? centeredResizePointer(pointer),
              constrainProportions || textCornerResize,
            )
          : resizeFromEdge(
              original,
              selectionGesture.handle,
              resizeSnap?.point ?? centeredResizePointer(pointer),
              constrainProportions,
            )
        : selectionGesture.kind === 'curve' && selectionGesture.handle && isCorner(selectionGesture.handle)
          ? setCornerRadius(
              original,
              selectionGesture.handle,
              curvePointer(original, selectionGesture.handle, pointer, selectionGesture.start),
            )
        : rotateRectangle(original, selectionGesture.start, pointer, constrainProportions)
  if (selectionGesture.kind === 'resize' && modifiers.alt) {
    const c = rectangleCenter(original)
    next = { ...next, x: c.x - next.width / 2, y: c.y - next.height / 2 }
  }
  if (selectionGesture.kind === 'move') {
    if (hasMultipleSelection.value) multiSelectionFrame.value = next
    moveSelectedShapes(selectionGesture.originalScene, {
      x: next.x - original.x,
      y: next.y - original.y,
    })
    return
  }
  if (hasMultipleSelection.value) {
    multiSelectionFrame.value = next
    const source = selectionGesture.originalScene
    for (const shape of [...source.rectangles, ...source.lines]) {
      if (!selectedShapeIds.value.includes(shape.id)) continue
      const transformed = transformShape(shape, original, next)
      if (isLine(transformed)) replaceLine(transformed); else replaceRectangle(transformed)
    }
    return
  }
  if (selectionGesture.labelOriginal) {
    const transformed = transformShape(selectionGesture.labelOriginal, original, next)
    if (!isLine(transformed)) replaceRectangle(transformed)
    return
  }
  if (isText(original)) {
    replaceRectangle(selectionGesture.kind === 'resize' ? resizeText(original, next, textCornerResize) : next)
  } else replaceRectangle(resizeLabel(original, next))
}

function updateLineSelection(point: Point) {
  if (!lineSelectionGesture) return
  const pointer = screenToWorld(point, latestViewport())
  const { original } = lineSelectionGesture
  const { kind } = lineSelectionGesture
  if (kind === 'move') {
    clearSnapFeedback()
    const moved = moveLine(original, constrainDelta({
      x: pointer.x - lineSelectionGesture.start.x,
      y: pointer.y - lineSelectionGesture.start.y,
    }))
    moveSelectedShapes(lineSelectionGesture.originalScene, {
      x: moved.start.x - original.start.x,
      y: moved.start.y - original.start.y,
    })
    return
  }

  if (kind === 'curve') {
    const control = lineControlPoint(original)
    replaceLine(setLineCurve(original, { x: control.x + pointer.x - lineSelectionGesture.start.x, y: control.y + pointer.y - lineSelectionGesture.start.y }))
    return
  }

  replaceLine(rotateLineEndpoint(original, kind, pointer, isShiftPressed.value))
}

function finishSelection(event: PointerEvent, restore = false): boolean {
  if (cycleClickPoint && cycleClickShape && !restore) {
    enteredGroup.value = cycleClickShape.groupId
    setSelection([cycleClickShape.id])
  }
  cycleClickPoint = undefined
  if (shiftClickShape && !restore) selectShape(shiftClickShape, true)
  shiftClickShape = undefined
  duplicateOnDrag = false
  if (lineSelectionGesture?.pointerId === event.pointerId) {
    if (restore) restoreGestureScene(lineSelectionGesture.rollbackScene ?? lineSelectionGesture.originalScene)
    lineSelectionGesture = undefined
    isCurving.value = false
    latestGesturePoint.value = undefined
    clearSnapFeedback()
    releasePointer(event.pointerId)
    if (!restore) commitScene()
    return true
  }
  if (!selectionGesture || selectionGesture.pointerId !== event.pointerId) return false
  if (restore) restoreGestureScene(selectionGesture.rollbackScene ?? selectionGesture.originalScene, selectionGesture.original)
  selectionGesture = undefined
  latestGesturePoint.value = undefined
  isRotating.value = false
  clearSnapFeedback()
  releasePointer(event.pointerId)
  if (!restore) commitScene()
  return true
}

function selectionHandleAt(point: Point): SelectionHandle | undefined {
  if (!selectionCorners.value) return undefined
  const frame = selectionFrame.value
  const cornerRadius = isTextSelected.value && frame
    ? Math.min(8, frame.height * viewport.scale / 4, frame.width * viewport.scale / 4)
    : HANDLE_HIT_RADIUS
  const corner = (Object.entries(selectionCorners.value) as [Corner, Point][]).find(([, cornerPoint]) =>
    distance(point, worldToScreen(cornerPoint, latestViewport())) <= cornerRadius,
  )?.[0]
  if (corner) return corner
  if (showCurveControls.value && visibleCurveHandles.value) {
    const curve = (Object.entries(visibleCurveHandles.value) as [Corner, Point][]).find(([, curvePoint]) =>
      distance(point, worldToScreen(curvePoint, latestViewport())) <= HANDLE_HIT_RADIUS,
    )?.[0]
    if (curve) return `curve-${curve}`
  }
  const rotationHandle = rotationHandleAt(point)
  if (rotationHandle) return rotationHandle
  const edgeHitRadius = isTextSelected.value && frame
    ? Math.min(HANDLE_HIT_RADIUS, Math.max(4, Math.min(frame.width, frame.height) * viewport.scale / 4))
    : HANDLE_HIT_RADIUS
  return edgeAtPoint(point, edgeHitRadius)
}

function replaceRectangle(next: RectangleShape) {
  const index = rectangles.value.findIndex((rectangle) => rectangle.id === next.id)
  if (index >= 0) rectangles.value.splice(index, 1, next)
}

function replaceLine(next: LineShape) {
  const index = lines.value.findIndex((line) => line.id === next.id)
  if (index >= 0) lines.value.splice(index, 1, next)
}

function shapeStyle(shape: Shape) {
  return {
    stroke: shape.stroke === null ? 'none' : shape.stroke ?? '#171717',
    fill: isLine(shape) || isImage(shape) || (isFreeDraw(shape) && !isClosedFreeDraw(shape)) ? 'none' : shape.fill ?? 'none',
    strokeWidth: `${shape.strokeWidth ?? 2}px`,
    strokeDasharray: shape.strokeStyle === 'dashed' ? '8 5' : shape.strokeStyle === 'dotted' ? '1 5' : undefined,
    strokeLinecap: shape.strokeStyle === 'dotted' ? 'round' as const : undefined,
    opacity: shape.opacity ?? 1,
  }
}

function previewSelectedStyle(patch: Pick<RectangleShape, 'stroke' | 'fill' | 'strokeWidth' | 'strokeStyle' | 'opacity'>): boolean {
  if (!selectedShapeIds.value.length) return false
  const selected = new Set(selectedShapeIds.value)
  rectangles.value = rectangles.value.map(shape => selected.has(shape.id) ? { ...shape, ...patch } : shape)
  lines.value = lines.value.map(shape => selected.has(shape.id) ? { ...shape, ...patch } : shape)
  return true
}

function updateSelectedStyle(patch: Pick<RectangleShape, 'stroke' | 'fill' | 'strokeWidth' | 'strokeStyle' | 'opacity'>) {
  if (previewSelectedStyle(patch)) commitScene()
}

function previewSelectedTextStyle(patch: TextStylePatch): boolean {
  if (!selectedTextShapes.value.length) return false
  const selected = new Set(selectedShapeIds.value)
  rectangles.value = rectangles.value.map(shape => {
    if (!selected.has(shape.id) || !isText(shape)) return shape
    const next = { ...shape, ...patch }
    if (!('fontSize' in patch || 'fontFamily' in patch || 'fontWeight' in patch || 'fontStyle' in patch)) return next
    const layout = layoutText(next.text, next.width, next.fontSize, next.wrap, next)
    return fitTextBounds(next, layout.width, layout.height)
  })
  return true
}

function updateSelectedTextStyle(patch: TextStylePatch) {
  if (previewSelectedTextStyle(patch)) commitScene()
}

function applyObjectColor(color: ObjectColor) {
  if (props.activeTool === 'draw') {
    Object.assign(drawStyle, { stroke: color.border, fill: color.fill })
    return
  }
  const selected = new Set(selectedShapeIds.value)
  rectangles.value = rectangles.value.map(shape => selected.has(shape.id) ? { ...shape, stroke: color.border, fill: color.fill } : shape)
  lines.value = lines.value.map(shape => selected.has(shape.id) ? { ...shape, stroke: color.border } : shape)
  commitScene()
}

function applySolidColor(color: string) {
  if (textEditor.value) {
    textEditor.value.fill = color
    if (textEditor.value.kind === 'label' && textEditor.value.shapeId) {
      const shape = rectangles.value.find((candidate) => candidate.id === textEditor.value?.shapeId)
      if (shape && !isText(shape)) replaceRectangle({ ...shape, labelFill: color })
    }
    return
  }
  if (selectedLabel.value?.label) {
    rectangles.value = rectangles.value.map(shape => shape.id === selectedLabel.value?.id ? { ...shape, labelFill: color } : shape)
    commitScene()
    return
  }
  if (!selectedShapes.value.length && props.activeTool === 'text') {
    armedTextStyle.fill = color
    return
  }
  const selected = new Set(selectedShapeIds.value)
  rectangles.value = rectangles.value.map(shape => selected.has(shape.id) ? { ...shape, fill: color } : shape)
  lines.value = lines.value.map(shape => selected.has(shape.id) ? { ...shape, stroke: color, ...(shape.kind === 'arrow' ? { arrowHeadFill: color } : {}) } : shape)
  commitScene()
}

function applyCustomPropertyColor(color: string | undefined, target?: 'border' | 'fill') {
  if (props.activeTool === 'draw') {
    if (target === 'border') drawStyle.stroke = color ?? null
    else drawStyle.fill = color ?? 'none'
    return
  }
  if (textPropertyControlsEnabled.value) {
    return updatePropertyTextStyle(target === 'border' ? { backgroundColor: color } : { fill: color })
  }
  const line = selectedShapes.value.at(-1)
  if (line && isLine(line) && target === 'fill') {
    const selected = new Set(selectedShapeIds.value)
    lines.value = lines.value.map(shape => {
      if (!selected.has(shape.id)) return shape
      return shape.kind === 'arrow' ? { ...shape, arrowHeadFill: color } : { ...shape, stroke: color ?? null }
    })
    commitScene()
    return
  }
  if (color === undefined) {
    if (target === 'border') return updateSelectedStyle({ stroke: null })
    if (textEditor.value?.kind === 'text') {
      textEditor.value.fill = undefined
      return
    }
    if (selectedTextShapes.value.length) return updateSelectedTextStyle({ fill: undefined })
    if (selectedShapes.value.length) return updateSelectedStyle({ fill: undefined })
    armedTextStyle.fill = undefined
    return
  }
  if (usesSolidColorPalette.value) return applySolidColor(color)
  updateSelectedStyle(target === 'border' ? { stroke: color } : { fill: color })
}

function applyCustomPropertyStyle(patch: Pick<RectangleShape, 'strokeWidth' | 'strokeStyle'>) {
  updateSelectedStyle(patch)
}

function reorderedSelectedShapes(action: 'front' | 'forward' | 'backward' | 'back') {
  const selected = new Set(selectedShapeIds.value)
  let ordered = [...allShapes.value]
  if (!selected.size) return
  if (action === 'front') ordered = [...ordered.filter(shape => !selected.has(shape.id)), ...ordered.filter(shape => selected.has(shape.id))]
  else if (action === 'back') ordered = [...ordered.filter(shape => selected.has(shape.id)), ...ordered.filter(shape => !selected.has(shape.id))]
  else if (action === 'forward') {
    for (let index = ordered.length - 1; index > 0; index--) {
      if (selected.has(ordered[index - 1]!.id) && !selected.has(ordered[index]!.id)) [ordered[index - 1], ordered[index]] = [ordered[index]!, ordered[index - 1]!]
    }
  } else {
    for (let index = 0; index < ordered.length - 1; index++) {
      if (selected.has(ordered[index + 1]!.id) && !selected.has(ordered[index]!.id)) [ordered[index], ordered[index + 1]] = [ordered[index + 1]!, ordered[index]!]
    }
  }
  return ordered.some((shape, index) => shape.id !== allShapes.value[index]!.id) ? ordered : undefined
}

function reorderSelectedShapes(action: 'front' | 'forward' | 'backward' | 'back') {
  const ordered = reorderedSelectedShapes(action)
  if (!ordered) return
  const order = new Map(ordered.map((shape, index) => [shape.id, index + 1]))
  rectangles.value = rectangles.value.map(shape => ({ ...shape, order: order.get(shape.id) }))
  lines.value = lines.value.map(shape => ({ ...shape, order: order.get(shape.id) }))
  commitScene()
}

function clearShapeSnapFeedback() {
  alignmentGuides.value = []
  spacingMarkers.value = []
}

function clearSnapFeedback() {
  clearShapeSnapFeedback()
}

function updateSelectionHover(point: Point) {
  const worldPoint = screenToWorld(point, latestViewport())
  isHoveringSelectedShape.value = Boolean(
    selectedRectangle.value && containsPoint(selectedRectangle.value, worldPoint),
  )
  const lineHandle = hasMultipleSelection.value ? undefined : lineSelectionHandleAt(point)
  const handle = selectionHandleAt(point) ?? (lineHandle === 'curve' ? 'line-curve' : undefined)
  hoveredSelectionHandle.value = handle
  if (handle) {
    isMoveReady.value = false
    return
  }
  isMoveReady.value =
    (hasMultipleSelection.value && selectionFrame.value && containsPoint(selectionFrame.value, worldPoint)) ||
    rectangles.value.some((rectangle) => containsPoint(rectangle, worldPoint)) ||
    lines.value.some((line) => containsLine(line, point))
}

function updateLinkHover(point: Point) {
  const worldPoint = screenToWorld(point, latestViewport())
  const shape = [...allShapes.value].reverse().find(candidate =>
    candidate.link && (isLine(candidate) ? containsLine(candidate, point) : containsPoint(candidate, worldPoint)),
  )
  if (!shape?.link) { linkHover.value = undefined; return }
  const frame = bounds([shape])!
  linkHover.value = {
    link: shape.link.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
    point: worldToScreen({ x: frame.x + frame.width / 2, y: frame.y }, latestViewport()),
  }
}

function lineSelectionHandleAt(point: Point): LineHandle | undefined {
  const line = selectedLine.value
  if (!line) return undefined
  if (distance(point, worldToScreen(line.start, latestViewport())) <= HANDLE_HIT_RADIUS) return 'start'
  if (distance(point, worldToScreen(line.end, latestViewport())) <= HANDLE_HIT_RADIUS) return 'end'
  if (distance(point, worldToScreen(lineControlPoint(line), latestViewport())) <= HANDLE_HIT_RADIUS) return 'curve'
  return undefined
}

function centeredResizePointer(pointer: Point): Point {
  const point = resizePointer(pointer)
  const start = selectionGesture?.handleStart
  return modifiers.alt && start ? { x: start.x + 2 * (point.x - start.x), y: start.y + 2 * (point.y - start.y) } : point
}
function resizePointer(pointer: Point): Point {
  if (!selectionGesture?.handleStart) return pointer
  return {
    x: selectionGesture.handleStart.x + pointer.x - selectionGesture.start.x,
    y: selectionGesture.handleStart.y + pointer.y - selectionGesture.start.y,
  }
}

function curvePointer(rectangle: RectangleShape, corner: Corner, pointer: Point, start: Point): Point {
  const radius = rectangle.cornerRadius
  const center = rectangleCenter(rectangle)
  const x = corner === 'northwest' || corner === 'southwest' ? rectangle.x + radius : rectangle.x + rectangle.width - radius
  const y = corner === 'northwest' || corner === 'northeast' ? rectangle.y + radius : rectangle.y + rectangle.height - radius
  const origin = rotatePoint({ x, y }, center, rectangle.rotation)
  return { x: origin.x + pointer.x - start.x, y: origin.y + pointer.y - start.y }
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function rotationHandlePoint(corner: Point, center: Point): Point {
  const direction = { x: corner.x - center.x, y: corner.y - center.y }
  const length = Math.hypot(direction.x, direction.y) || 1
  return {
    x: corner.x + direction.x / length * ROTATION_HANDLE_OFFSET,
    y: corner.y + direction.y / length * ROTATION_HANDLE_OFFSET,
  }
}

function rotationCursorUrl(angle: number): string {
  const bodyStart = rotateCursorSvg.indexOf('>') + 1
  const bodyEnd = rotateCursorSvg.lastIndexOf('</svg>')
  const svg = `${rotateCursorSvg.slice(0, bodyStart)}<g transform="rotate(${angle.toFixed(2)} 12 12)">${rotateCursorSvg.slice(bodyStart, bodyEnd)}</g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function rotationHandleAt(point: Point): RotationHandle | undefined {
  const handles = rotationHandles.value
  if (!handles) return undefined
  const corner = (Object.entries(handles) as [Corner, Point][]).find(([, handle]) =>
    distance(point, handle) <= ROTATION_HIT_RADIUS,
  )?.[0]
  return corner ? `rotate-${corner}` : undefined
}

function refreshActiveGesture() {
  if (!latestGesturePoint.value) return
  if (rectangleGesture) updateRectangle(latestGesturePoint.value)
  else if (lineGesture) updateLine(latestGesturePoint.value)
  else if (selectionGesture || lineSelectionGesture) updateSelection(latestGesturePoint.value)
}

function resizeHandlePoint(rectangle: RectangleShape, handle: ResizeHandle): Point {
  const corners = rectangleCorners(rectangle)
  if (isCorner(handle)) return corners[handle]
  const center = rectangleCenter(rectangle)
  const points: Record<Edge, Point> = {
    north: rotatePoint({ x: center.x, y: rectangle.y }, center, rectangle.rotation),
    east: rotatePoint({ x: rectangle.x + rectangle.width, y: center.y }, center, rectangle.rotation),
    south: rotatePoint({ x: center.x, y: rectangle.y + rectangle.height }, center, rectangle.rotation),
    west: rotatePoint({ x: rectangle.x, y: center.y }, center, rectangle.rotation),
  }
  return points[handle]
}

function edgeAtPoint(point: Point, hitRadius: number): Edge | undefined {
  if (!selectionCorners.value) return undefined
  const corners = selectionCorners.value
  const edges: Partial<Record<Edge, [Point, Point]>> = {
    north: [corners.northwest, corners.northeast],
    east: [corners.northeast, corners.southeast],
    south: [corners.southwest, corners.southeast],
    west: [corners.northwest, corners.southwest],
  }
  if (isTextSelected.value) {
    delete edges.north
    delete edges.south
  }
  return (Object.entries(edges) as [Edge, [Point, Point]][]).find(([, [start, end]]) =>
    distanceToSegment(point, worldToScreen(start, latestViewport()), worldToScreen(end, latestViewport())) <= hitRadius,
  )?.[0]
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const delta = { x: end.x - start.x, y: end.y - start.y }
  const lengthSquared = delta.x ** 2 + delta.y ** 2
  if (lengthSquared === 0) return distance(point, start)
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * delta.x + (point.y - start.y) * delta.y) / lengthSquared),
  )
  return distance(point, { x: start.x + delta.x * projection, y: start.y + delta.y * projection })
}

function containsLine(line: LineShape, point: Point): boolean {
  const samples = 20
  for (let index = 1, previous = worldToScreen(linePointAt(line, 0), latestViewport()); index <= samples; index++) {
    const current = worldToScreen(linePointAt(line, index / samples), latestViewport())
    if (distanceToSegment(point, previous, current) <= LINE_HIT_RADIUS) return true
    previous = current
  }
  return false
}

function copyLine(line: LineShape): LineShape {
  return { ...line, start: { ...line.start }, end: { ...line.end }, curve: typeof line.curve === 'object' ? { ...line.curve } : line.curve }
}

function nextId(kind: string): string {
  return createId(kind)
}

function nextGroupId(): string {
  return createId('group')
}

function releasePointer(pointerId: number) {
  if (root.value?.hasPointerCapture(pointerId)) root.value.releasePointerCapture(pointerId)
}

function isCorner(handle: ResizeHandle): handle is Corner {
  return handle === 'northwest' || handle === 'northeast' || handle === 'southeast' || handle === 'southwest'
}

function curveCorner(handle: CurveHandle): Corner {
  return handle.slice('curve-'.length) as Corner
}

function isCurveHandle(handle: SelectionHandle): handle is CurveHandle {
  return handle.startsWith('curve-')
}

function isRotateHandle(handle: SelectionHandle | undefined): handle is RotationHandle {
  return handle === 'rotate' || Boolean(handle?.startsWith('rotate-'))
}

function isEllipse(shape: Shape): boolean {
  return (shape as { kind?: string }).kind === 'ellipse'
}

function isDiamond(shape: Shape): boolean {
  return (shape as { kind?: string }).kind === 'diamond'
}

function isText(shape: Shape): shape is TextShape {
  return (shape as { kind?: string }).kind === 'text'
}

function isImage(shape: Shape): shape is ImageShape {
  return (shape as { kind?: string }).kind === 'image'
}

function resizeText(original: TextShape, next: RectangleShape, scaleFont: boolean): TextShape {
  const scale = Math.max(8 / original.fontSize, next.width / original.width)
  const fontSize = scaleFont ? original.fontSize * scale : original.fontSize
  const width = scaleFont ? original.width * scale : Math.max(24, next.width)
  const wrap = !scaleFont || original.wrap
  const layout = layoutText(original.text, width, fontSize, wrap, original)
  const handle = selectionGesture?.handle
  const anchor = {
    x: handle === 'west' || handle === 'northwest' || handle === 'southwest' ? 1 : 0,
    y: handle === 'northwest' || handle === 'northeast' ? 1 : 0,
  }
  const bounds = fitTextBounds(next, layout.width, layout.height, modifiers.alt ? { x: 0.5, y: 0.5 } : anchor)
  return { ...original, ...bounds, fontSize, wrap }
}

function fitTextBounds(shape: RectangleShape, width: number, height: number, anchor: Point = { x: 0, y: 0 }): RectangleShape {
  // Keep the local anchor fixed in world space while the text box reflows.
  const anchorPoint = rotatePoint(
    { x: shape.x + shape.width * anchor.x, y: shape.y + shape.height * anchor.y },
    rectangleCenter(shape), shape.rotation,
  )
  const center = rotatePoint(
    { x: anchorPoint.x + width * (0.5 - anchor.x), y: anchorPoint.y + height * (0.5 - anchor.y) },
    anchorPoint, shape.rotation,
  )
  return { ...shape, x: center.x - width / 2, y: center.y - height / 2, width, height }
}

function resizeLabel(original: RectangleShape, next: RectangleShape): RectangleShape {
  if (!original.label) return next
  const scale = Math.min(next.width / original.width, next.height / original.height)
  return { ...next, labelFontSize: Math.max(MIN_LABEL_FONT_SIZE, (original.labelFontSize ?? 16) * scale) }
}

function labelTextWidth(shape: RectangleShape): number {
  const width = isEllipse(shape) || isDiamond(shape) ? shape.width / Math.SQRT2 : shape.width
  return Math.max(1, width - LABEL_PADDING * 2)
}

function labelTextX(shape: RectangleShape): number {
  return shape.x + (shape.width - labelTextWidth(shape)) / 2
}

function labelSelectionBounds(shape: RectangleShape): RectangleShape {
  const layout = labelLayout(shape, shape.label ?? '')
  const innerWidth = labelTextWidth(shape)
  const width = labelTextAlign(shape) === 'justify' && layout.lines.length > 1
    ? innerWidth
    : Math.min(innerWidth, Math.max(shape.labelFontSize ?? 16, layout.contentWidth))
  const x = labelTextAlign(shape) === 'left' || labelTextAlign(shape) === 'justify'
    ? labelTextX(shape)
    : labelTextAlign(shape) === 'right' ? labelTextX(shape) + innerWidth - width : shape.x + (shape.width - width) / 2
  return { ...shape, x, y: shape.y + (shape.height - layout.height) / 2, width, height: layout.height, cornerRadius: 0 }
}

function containsLabelPoint(shape: RectangleShape, point: Point): boolean {
  const local = rotatePoint(point, rectangleCenter(shape), -shape.rotation)
  const box = labelSelectionBounds(shape)
  return local.x >= box.x && local.x <= box.x + box.width && local.y >= box.y && local.y <= box.y + box.height
}

function labelTextAlign(shape: RectangleShape): NonNullable<TextShape['textAlign']> {
  return shape.labelTextAlign ?? 'center'
}

function labelLines(shape: RectangleShape): string[] {
  return layoutText(shape.label ?? '', labelTextWidth(shape), shape.labelFontSize ?? 16, true, {
    fontFamily: shape.labelFontFamily ?? 'shantell',
    fontWeight: shape.labelFontWeight ?? 400,
    fontStyle: shape.labelFontStyle ?? 'normal',
  }).lines
}

function labelLineX(shape: RectangleShape): number {
  return labelTextAlign(shape) === 'left' || labelTextAlign(shape) === 'justify'
    ? labelTextX(shape)
    : labelTextAlign(shape) === 'right' ? labelTextX(shape) + labelTextWidth(shape) : shape.x + shape.width / 2
}

function labelLayout(shape: RectangleShape, text: string, fontSize = shape.labelFontSize ?? 16, fontFamily: TextFontFamily = shape.labelFontFamily ?? 'shantell', style: Pick<TextShape, 'fontWeight' | 'fontStyle'> = {}) {
  return layoutText(text, labelTextWidth(shape), fontSize, true, {
    fontFamily,
    fontWeight: style.fontWeight ?? shape.labelFontWeight ?? 400,
    fontStyle: style.fontStyle ?? shape.labelFontStyle ?? 'normal',
  })
}

function fitLabel(shape: RectangleShape, text: string, fontSize = shape.labelFontSize ?? 16, fontFamily: TextFontFamily = shape.labelFontFamily ?? 'shantell', style: Pick<TextShape, 'fontWeight' | 'fontStyle'> = {}) {
  const layout = labelLayout(shape, text, fontSize, fontFamily, style)
  const scale = isEllipse(shape) || isDiamond(shape) ? Math.max(1, (layout.height + LABEL_PADDING * 2) * Math.SQRT2 / shape.height) : 1
  const width = shape.width * scale
  const height = isEllipse(shape) || isDiamond(shape) ? shape.height * scale : Math.max(shape.height, layout.height + LABEL_PADDING * 2)
  return {
    shape: {
      ...shape,
      x: shape.x - (width - shape.width) / 2,
      y: shape.y - (height - shape.height) / 2,
      width,
      height,
    },
    layout,
  }
}

function wrapText(text: string, width: number, fontSize: number, wrap = true, fontFamily: TextFontFamily = 'shantell'): string[] {
  return layoutText(text, width, fontSize, wrap, { fontFamily }).lines
}

function shapeFromPoints(start: Point, end: Point, id: string, constrainProportions = false): RectangleShape {
  if (props.activeTool === 'ellipse') return ellipseFromPoints(start, end, id, constrainProportions)
  if (props.activeTool === 'diamond') return diamondFromPoints(start, end, id, constrainProportions)
  return rectangleFromPoints(start, end, id, constrainProportions)
}

function beginDraw(event: PointerEvent, point: Point) {
  const world = screenToWorld(point, latestViewport())
  drawPointerId = event.pointerId
  pendingDraw.value = {
    id: 'pending-draw', kind: 'freedraw', points: [world], pressures: [event.pressure],
    simulatePressure: true, x: world.x, y: world.y, width: 0, height: 0,
    rotation: 0, cornerRadius: 0, stroke: drawStyle.stroke, fill: drawStyle.fill, strokeWidth: drawStyle.strokeWidth,
    strokeStyle: drawStyle.strokeStyle, opacity: drawStyle.opacity,
  }
  root.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function updateDraw(event: PointerEvent) {
  const shape = pendingDraw.value
  if (!shape) return
  const samples = event.getCoalescedEvents?.()
  for (const sample of samples?.length ? samples : [event]) {
    const point = screenToWorld(localPoint(sample), latestViewport())
    if (distance(point, shape.points.at(-1)!) * viewport.scale < 1) continue
    shape.points.push(point)
    shape.pressures.push(sample.pressure)
  }
  const first = shape.points[0]!
  const last = shape.points.at(-1)!
  // ponytail: fixed 12px closure snap; make tolerance configurable if user testing needs it.
  if (shape.points.length > 2 && distance(first, last) * viewport.scale <= 12) {
    shape.points[shape.points.length - 1] = { ...first }
  }
  const xs = shape.points.map(point => point.x), ys = shape.points.map(point => point.y)
  Object.assign(shape, { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) })
}

function finishDraw(event: PointerEvent) {
  if (drawPointerId !== event.pointerId || !pendingDraw.value) return false
  if (event.type === 'pointerup') updateDraw(event)
  const shape = { ...pendingDraw.value, id: nextId('draw'), points: [...pendingDraw.value.points], pressures: [...pendingDraw.value.pressures] }
  rectangles.value.push(shape)
  pendingDraw.value = undefined
  drawPointerId = undefined
  releasePointer(event.pointerId)
  commitScene()
  return true
}

function beginErase(event: PointerEvent, point: Point) {
  eraserPointerId = event.pointerId
  eraseOriginal = copyScene()
  erasedShapeIds.value = []
  eraserLastPoint = screenToWorld(point, latestViewport())
  eraserTrail.value?.add(eraserLastPoint, true, event.timeStamp)
  root.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function updateErase(event: PointerEvent) {
  if (eraserPointerId !== event.pointerId) return
  const next = screenToWorld(localPoint(event), latestViewport())
  const previous = eraserLastPoint ?? next
  eraserLastPoint = next
  eraserTrail.value?.add(next, false, event.timeStamp)
  const hits = allShapes.value.filter(shape => eraseHit(shape, previous, next)).flatMap(shape =>
    shape.groupId ? allShapes.value.filter(candidate => candidate.groupId === shape.groupId).map(candidate => candidate.id) : [shape.id],
  )
  const ids = new Set(erasedShapeIds.value)
  for (const id of hits) event.altKey ? ids.delete(id) : ids.add(id)
  erasedShapeIds.value = [...ids]
}

function eraseHit(shape: Shape, start: Point, end: Point): boolean {
  if (isLine(shape)) {
    for (let index = 1, previous = linePointAt(shape, 0); index <= 20; index++) {
      const current = linePointAt(shape, index / 20)
      if (segmentDistance(start, end, previous, current) <= 8 / viewport.scale) return true
      previous = current
    }
    return false
  }
  if (isFreeDraw(shape)) {
    return shape.points.some((point, index) => index > 0 && segmentDistance(start, end, shape.points[index - 1]!, point) <= (shape.strokeWidth ?? 2) / 2 + 6 / viewport.scale)
  }
  const frame = bounds([shape])!
  return containsPoint(frame, end) || segmentDistance(start, end, { x: frame.x, y: frame.y }, { x: frame.x + frame.width, y: frame.y + frame.height }) <= 6 / viewport.scale
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b))
}

function finishErase(event: PointerEvent) {
  if (eraserPointerId !== event.pointerId) return false
  if (event.type === 'pointerup') updateErase(event)
  const ids = [...erasedShapeIds.value]
  eraserPointerId = undefined
  eraserLastPoint = undefined
  erasedShapeIds.value = []
  eraseOriginal = undefined
  releasePointer(event.pointerId)
  if (ids.length) deleteShapes(ids)
  return true
}

function resizeCursor(handle: SelectionHandle | undefined): 'ns' | 'ew' | 'nwse' | 'nesw' | undefined {
  if (!handle || isRotateHandle(handle) || handle === 'line-curve' || isCurveHandle(handle)) return undefined
  const rotation = selectionFrame.value?.rotation ?? 0
  if (handle === 'north' || handle === 'south') return cursorForAngle(rotation + 90)
  if (handle === 'east' || handle === 'west') return cursorForAngle(rotation)
  return cursorForAngle(rotation + (handle === 'northwest' || handle === 'southeast' ? 45 : 135))
}

function cursorForAngle(angle: number): 'ns' | 'ew' | 'nwse' | 'nesw' {
  const directions = ['ew', 'nwse', 'ns', 'nesw'] as const
  const normalized = ((angle % 180) + 180) % 180
  return directions[Math.round(normalized / 45) % directions.length]
}

function onPointerDown(event: PointerEvent) {
  if (drawingLoading.value || editableTarget(event.target) || (event.target as Element).closest('button')) return
  root.value?.focus({ preventScroll: true })
  isShiftPressed.value = event.shiftKey
  if (event.button === 2) return
  if (textEditor.value) {
    const creatingText = textEditor.value.kind === 'text' && !textEditor.value.shapeId
    finishTextEditor()
    if (creatingText) {
      event.preventDefault()
      return
    }
  }

  const point = localPoint(event)
  if (croppingImage.value && event.button === 0) {
    beginCropSelection(event, point)
    return
  }
  if (props.activeTool === 'laser' && event.button === 0 && !isSpacePressed.value && !isPanning.value) {
    laserPointerId = event.pointerId
    pointers.set(event.pointerId, { ...point, pointerType: event.pointerType })
    root.value?.setPointerCapture(event.pointerId)
    laserTrail.value?.add(screenToWorld(point, latestViewport()), true, event.timeStamp)
    event.preventDefault()
    return
  }
  if (props.activeTool === 'draw' && event.button === 0 && !isSpacePressed.value) {
    beginDraw(event, point)
    return
  }
  if (props.activeTool === 'eraser' && event.button === 0 && !isSpacePressed.value) {
    beginErase(event, point)
    return
  }
  if (event.pointerType === 'touch') {
    const contacts = [...pointers.entries()].filter(([, p]) => p.pointerType === 'touch')
    if (contacts.length) {
      cancelGesture()
      for (const [id, sample] of contacts) pointers.set(id, sample)
      pointers.set(event.pointerId, { ...point, pointerType: 'touch' })
      for (const id of pointers.keys()) root.value?.setPointerCapture(id)
      beginPinch(); event.preventDefault(); return
    }
    pointers.set(event.pointerId, { ...point, pointerType: 'touch' })
  }
  if (['rectangle', 'diamond', 'ellipse'].includes(props.activeTool ?? '') && event.button === 0 && !isSpacePressed.value) {
    beginRectangle(event, point)
    return
  }
  if (['line', 'arrow'].includes(props.activeTool ?? '') && event.button === 0 && !isSpacePressed.value) {
    beginLine(event, point)
    return
  }
  if (props.activeTool === 'text' && event.button === 0 && !isSpacePressed.value) {
    beginText(event, point)
    return
  }
  if (props.activeTool === 'image' && event.button === 0 && !isSpacePressed.value) {
    openImagePicker(point)
    event.preventDefault()
    return
  }
  if (props.activeTool === 'select' && event.button === 0 && !isSpacePressed.value) {
    const repeatedClick = lastSelectPointerDown
      && event.timeStamp - lastSelectPointerDown.time < 500
      && distance(point, lastSelectPointerDown.point) < 6
    lastSelectPointerDown = { time: event.timeStamp, point }
    if (repeatedClick) {
      event.preventDefault()
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const worldPoint = screenToWorld(point, latestViewport())
      const linked = [...allShapes.value].reverse().find(shape => shape.link && (isLine(shape) ? containsLine(shape, point) : containsPoint(shape, worldPoint)))
      if (linked?.link) { window.open(linked.link, '_blank', 'noopener,noreferrer'); event.preventDefault(); return }
    }
    startSelection(event, point)
    return
  }

  const isTouch = event.pointerType === 'touch'
  const isPen = event.pointerType === 'pen'
  const isMiddleButton = event.button === 1
  const isSpacePan = event.button === 0 && isSpacePressed.value
  const canTrack = isTouch || isPen || isMiddleButton || isSpacePan
  if (!canTrack || awaitingTouchRelease.value) return

  pointers.set(event.pointerId, { ...point, pointerType: event.pointerType })
  root.value?.setPointerCapture(event.pointerId)
  event.preventDefault()

  if (pointers.size === 2) {
    beginPinch()
    return
  }

  if (pointers.size === 1) {
    if (isTouch || isMiddleButton || isSpacePan) {
      singlePointerStart = { point, viewport: latestViewport() }
      isPanning.value = true
    }
  }
}

function onPointerMove(event: PointerEvent) {
  modifiers.alt = event.altKey
  modifiers.bypass = event.ctrlKey || event.metaKey
  if (drawPointerId === event.pointerId) { updateDraw(event); event.preventDefault(); return }
  if (eraserPointerId === event.pointerId) { updateErase(event); event.preventDefault(); return }
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { ...localPoint(event), pointerType: event.pointerType })
  if (cropGesture?.pointerId === event.pointerId) {
    updateCropSelection(localPoint(event))
    event.preventDefault()
    return
  }
  if (marqueeGesture?.pointerId === event.pointerId) {
    const frame = rectangleFromPoints(marqueeGesture.start, screenToWorld(localPoint(event), latestViewport()), 'marquee')
    marquee.value = frame
    const hits = allShapes.value.filter(shape => {
      const b = bounds([shape])!
      return b.x <= frame.x + frame.width && b.x + b.width >= frame.x && b.y <= frame.y + frame.height && b.y + b.height >= frame.y
    })
    const groups = new Set(hits.map(s => s.groupId).filter(Boolean))
    setSelection([...new Set([...marqueeGesture.previous, ...allShapes.value.filter(s => hits.includes(s) || (s.groupId && groups.has(s.groupId))).map(s => s.id)])])
    event.preventDefault()
    return
  }
  if (laserPointerId === event.pointerId) {
    const point = localPoint(event)
    pointers.set(event.pointerId, { ...point, pointerType: event.pointerType })
    const samples = event.getCoalescedEvents?.()
    for (const sample of samples?.length ? samples : [event]) {
      laserTrail.value?.add(screenToWorld(localPoint(sample), latestViewport()), false, sample.timeStamp)
    }
    event.preventDefault()
    return
  }
  if (textGesture?.pointerId === event.pointerId) {
    updateText(event)
    event.preventDefault()
    return
  }
  if (rectangleGesture?.pointerId === event.pointerId) {
    isShiftPressed.value = event.shiftKey
    latestGesturePoint.value = localPoint(event)
    autoPan(latestGesturePoint.value)
    updateRectangle(latestGesturePoint.value)
    event.preventDefault()
    return
  }
  if (lineGesture?.pointerId === event.pointerId) {
    isShiftPressed.value = event.shiftKey
    latestGesturePoint.value = localPoint(event)
    autoPan(latestGesturePoint.value)
    updateLine(latestGesturePoint.value)
    event.preventDefault()
    return
  }
  if (selectionGesture?.pointerId === event.pointerId) {
    isShiftPressed.value = event.shiftKey
    latestGesturePoint.value = localPoint(event)
    updateSelection(latestGesturePoint.value)
    if (!selectedShapes.value.some(isText)) {
      autoPan(latestGesturePoint.value)
    }
    event.preventDefault()
    return
  }
  if (lineSelectionGesture?.pointerId === event.pointerId) {
    isShiftPressed.value = event.shiftKey
    latestGesturePoint.value = localPoint(event)
    autoPan(latestGesturePoint.value)
    updateSelection(latestGesturePoint.value)
    event.preventDefault()
    return
  }
  if (props.activeTool === 'select') {
    updateSelectionHover(localPoint(event))
    updateLinkHover(localPoint(event))
  } else {
    linkHover.value = undefined
  }
  if (!pointers.has(event.pointerId)) return
  const point = localPoint(event)
  const previous = pointers.get(event.pointerId)!
  pointers.set(event.pointerId, { ...point, pointerType: previous.pointerType })
  event.preventDefault()

  if (pointers.size >= 2 && pinchStart) {
    const [a, b] = [...pointers.values()]
    if (!a || !b) return
    const currentCentroid = centroid(a, b)
    const nextScale = pinchStart.viewport.scale * (distance(a, b) / pinchStart.distance)
    const zoomed = zoomAt(pinchStart.viewport, pinchStart.centroid, nextScale)
    queueViewport(
      {
        ...zoomed,
        translationX: zoomed.translationX + currentCentroid.x - pinchStart.centroid.x,
        translationY: zoomed.translationY + currentCentroid.y - pinchStart.centroid.y,
      },
      true,
    )
    return
  }

  if (singlePointerStart) {
    queueViewport({
      ...singlePointerStart.viewport,
      translationX: singlePointerStart.viewport.translationX + point.x - singlePointerStart.point.x,
      translationY: singlePointerStart.viewport.translationY + point.y - singlePointerStart.point.y,
    })
  }
}

function finishPointer(event: PointerEvent) {
  if (finishDraw(event)) return
  if (finishErase(event)) return
  if (finishCrop(event)) return
  if (!pinchStart && (marqueeGesture || rectangleGesture || lineGesture || textGesture || selectionGesture || lineSelectionGesture)) pointers.delete(event.pointerId)
  if (marqueeGesture?.pointerId === event.pointerId) {
    marqueeGesture = undefined; marquee.value = undefined; releasePointer(event.pointerId); return
  }
  if (laserPointerId === event.pointerId) {
    laserPointerId = undefined
    if (event.type === 'pointerup') laserTrail.value?.add(screenToWorld(localPoint(event), latestViewport()), false, event.timeStamp)
  }
  if (finishText(event)) return
  if (finishRectangle(event)) return
  if (finishLine(event)) return
  if (finishSelection(event)) return
  if (!pointers.has(event.pointerId)) return
  const wasPinching = pointers.size >= 2 || Boolean(pinchStart)
  pointers.delete(event.pointerId)
  releasePointer(event.pointerId)
  singlePointerStart = undefined
  pinchStart = undefined

  if (wasPinching && pointers.size > 0) awaitingTouchRelease.value = true
  if (pointers.size === 0) {
    awaitingTouchRelease.value = false
    isPanning.value = false
  }
}

function cancelPointer(event: PointerEvent) {
  if (cancellingGesture) return
  if (drawPointerId === event.pointerId || eraserPointerId === event.pointerId) { cancelGesture(); return }
  if (cropGesture?.pointerId === event.pointerId) { cancelCrop(); return }
  if (!pinchStart && (marqueeGesture || rectangleGesture || lineGesture || textGesture || selectionGesture || lineSelectionGesture)) pointers.delete(event.pointerId)
  if (marqueeGesture?.pointerId === event.pointerId) { cancelGesture(); return }
  if (textGesture?.pointerId === event.pointerId) {
    textGesture = undefined
    pendingText.value = undefined
    releasePointer(event.pointerId)
    return
  }
  if (rectangleGesture?.pointerId === event.pointerId) {
    pendingRectangle.value = undefined
    rectangleGesture = undefined
    latestGesturePoint.value = undefined
    releasePointer(event.pointerId)
    return
  }
  if (lineGesture?.pointerId === event.pointerId) {
    pendingLine.value = undefined
    lineGesture = undefined
    latestGesturePoint.value = undefined
    clearSnapFeedback()
    releasePointer(event.pointerId)
    return
  }
  if (finishSelection(event, true)) return
  finishPointer(event)
}

function restoreGestureScene(scene: SceneSnapshot, frame?: RectangleShape) {
  const restored = copyScene(scene)
  rectangles.value = restored.rectangles; lines.value = restored.lines
  multiSelectionFrame.value = hasMultipleSelection.value ? frame ?? selectionOutline(bounds(allShapes.value.filter(shape => selectedShapeIds.value.includes(shape.id)))!) : undefined
}
function cancelGesture() {
  if (cancellingGesture) return
  cancellingGesture = true
  cancelCrop()
  if (marqueeGesture) { setSelection(marqueeGesture.previous); releasePointer(marqueeGesture.pointerId) }
  marqueeGesture = undefined; marquee.value = undefined
  laserPointerId = undefined
  laserTrail.value?.clear()
  if (drawPointerId !== undefined) releasePointer(drawPointerId)
  if (eraserPointerId !== undefined) releasePointer(eraserPointerId)
  drawPointerId = undefined
  eraserPointerId = undefined
  pendingDraw.value = undefined
  eraserLastPoint = undefined
  eraserTrail.value?.clear()
  erasedShapeIds.value = []
  if (eraseOriginal) restoreGestureScene(eraseOriginal)
  eraseOriginal = undefined
  for (const id of pointers.keys()) {
    releasePointer(id)
  }
  if (rectangleGesture) releasePointer(rectangleGesture.pointerId)
  if (lineGesture) releasePointer(lineGesture.pointerId)
  if (selectionGesture) releasePointer(selectionGesture.pointerId)
  if (lineSelectionGesture) releasePointer(lineSelectionGesture.pointerId)
  if (textGesture) releasePointer(textGesture.pointerId)
  pointers.clear()
  pendingRectangle.value = undefined
  rectangleGesture = undefined
  pendingLine.value = undefined
  lineGesture = undefined
  pendingText.value = undefined
  textGesture = undefined
  if (selectionGesture) restoreGestureScene(selectionGesture.rollbackScene ?? selectionGesture.originalScene, selectionGesture.original)
  selectionGesture = undefined
  if (lineSelectionGesture) restoreGestureScene(lineSelectionGesture.rollbackScene ?? lineSelectionGesture.originalScene)
  lineSelectionGesture = undefined
  isCurving.value = false
  isRotating.value = false
  clearSnapFeedback()
  singlePointerStart = undefined
  pinchStart = undefined
  awaitingTouchRelease.value = false
  isPanning.value = false
  isSpacePressed.value = false
  isShiftPressed.value = false
  latestGesturePoint.value = undefined
  cancellingGesture = false
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const delta = normalizedWheelDelta(event)
  const current = latestViewport()
  if (event.ctrlKey || event.metaKey) {
    setZoom(current.scale * Math.exp(-delta.y * 0.002), localPoint(event))
    return
  }
  queueViewport({
    ...current,
    translationX: current.translationX - delta.x,
    translationY: current.translationY - delta.y,
  })
}

function normalizedWheelDelta(event: WheelEvent): Point {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return { x: event.deltaX * 16, y: event.deltaY * 16 }
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return { x: event.deltaX * size.x, y: event.deltaY * size.y }
  }
  return { x: event.deltaX, y: event.deltaY }
}

function editableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
}

function onKeyDown(event: KeyboardEvent) {
  if ((event.target as Element)?.closest('button, a') && [' ', 'Enter', 'Tab'].includes(event.key)) return
  if (drawingLoading.value || editableTarget(event.target) || event.isComposing || event.defaultPrevented) return
  modifiers.alt = event.altKey
  modifiers.bypass = event.ctrlKey || event.metaKey
  if (['Alt', 'Control', 'Meta'].includes(event.key)) refreshActiveGesture()
  if (event.key === 'Shift') {
    if (!isShiftPressed.value) {
      isShiftPressed.value = true
      refreshActiveGesture()
    }
    return
  }
  isShiftPressed.value = event.shiftKey
  const key = event.key.toLowerCase()
  if (event.key === 'Escape' && croppingImage.value) {
    cancelCrop()
    event.preventDefault()
    return
  }
  if ((event.ctrlKey || event.metaKey) && ['a', 'd'].includes(key)) {
    event.preventDefault()
    if (key === 'a') setSelection(allShapes.value.map(s => s.id)); else duplicateSelection()
    return
  }
  if (event.key === 'Tab' && event.target === root.value && allShapes.value.length) {
    const index = allShapes.value.findIndex(s => s.id === selectedShapeIds.value.at(-1))
    const shape = allShapes.value[(index + (event.shiftKey ? -1 : 1) + allShapes.value.length) % allShapes.value.length]!
    selectShape(shape)
    liveMessage.value = `Selected ${shapeLabel(shape)}`
    event.preventDefault(); return
  }
  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    event.shiftKey ? redoScene() : undoScene()
    event.preventDefault()
    return
  }
  if ((event.ctrlKey || event.metaKey) && key === 'y') {
    redoScene()
    event.preventDefault()
    return
  }
  if ((event.ctrlKey || event.metaKey) && ['c', 'v', 'x'].includes(key)) return
  if ((event.ctrlKey || event.metaKey) && key === 'g') {
    event.shiftKey ? ungroupSelection() : groupSelectedShapes()
    event.preventDefault()
    return
  }
  if (event.key === 'Enter' && props.activeTool === 'select' && selectedRectangle.value && isText(selectedRectangle.value)) {
    event.preventDefault()
    editText(selectedRectangle.value)
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && deleteSelectedShape()) {
    liveMessage.value = 'Selection deleted'
    event.preventDefault()
    return
  }
  const nudges: Record<string, Point> = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
  }
  const nudge = nudges[event.key]
  const distance = event.shiftKey ? 10 : 1
  if (nudge && moveSelectedShape(nudge.x * distance, nudge.y * distance)) {
    event.preventDefault()
    return
  }
  if (event.code === 'Space') {
    isSpacePressed.value = true
    event.preventDefault()
  } else if (event.key === '+' || event.key === '=') {
    stepZoom(1)
    event.preventDefault()
  } else if (event.key === '-') {
    stepZoom(-1)
    event.preventDefault()
  } else if (event.key === '0') {
    resetZoom()
    event.preventDefault()
  } else if (event.key.toLowerCase() === 'r') {
    emit('activateRectangle')
    event.preventDefault()
  } else if (key === 'd') {
    emit('activateDiamond')
    event.preventDefault()
  } else if (key === 'c' || key === 'o') {
    emit('activateEllipse')
    event.preventDefault()
  } else if (key === 'l') {
    emit('activateLine')
    event.preventDefault()
  } else if (key === 'a') {
    emit('activateArrow')
    event.preventDefault()
  } else if (key === 't' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    emit('activateText')
    event.preventDefault()
  } else if (key === 'i' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    emit('activateImage')
    event.preventDefault()
  } else if (key === 'p') {
    emit('activateDraw')
    event.preventDefault()
  } else if (key === 'e' || event.key === '0') {
    emit('activateEraser')
    event.preventDefault()
  } else if (event.key === 'Escape') {
    cancelGesture()
    clearSelection()
    enteredGroup.value = undefined
    root.value?.focus()
    emit('cancelTool')
  }
}

function onDoubleClick(event: MouseEvent) {
  if (props.activeTool !== 'select' || textEditor.value || isSpacePressed.value || editableTarget(event.target)) return
  const point = localPoint(event)
  const worldPoint = screenToWorld(point, latestViewport())
  const hit = [...allShapes.value].reverse().find(shape => isLine(shape) ? containsLine(shape, point) : containsPoint(shape, worldPoint))
  if (hit?.groupId && enteredGroup.value !== hit.groupId) { enteredGroup.value = hit.groupId; selectShape(hit); return }
  if (hit && isLine(hit)) { selectShape(hit); event.preventDefault(); return }
  if (hit && isImage(hit)) { selectShape(hit); void beginCrop(); event.preventDefault(); return }
  if (hit && isText(hit)) editText(hit)
  else if (hit) editLabel(hit)
  else startTextEditor({ kind: 'text', text: '', x: worldPoint.x, y: worldPoint.y - 10, width: 16, height: 20, fontSize: armedTextStyle.fontSize, fontFamily: armedTextStyle.fontFamily, wrap: false })
  event.preventDefault()
}

function onTextEditorKeyDown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.isComposing) return
  if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
    event.preventDefault()
    finishTextEditor()
    root.value?.focus({ preventScroll: true })
  }
}

function onKeyUp(event: KeyboardEvent) {
  modifiers.alt = event.altKey
  modifiers.bypass = event.ctrlKey || event.metaKey
  if (['Alt', 'Control', 'Meta'].includes(event.key)) refreshActiveGesture()
  if (event.code === 'Space') isSpacePressed.value = false
  if (event.key === 'Shift' && isShiftPressed.value) {
    isShiftPressed.value = false
    refreshActiveGesture()
  }
}

function onResize(width: number, height: number) {
  const nextSize = { x: width, y: height }
  applyViewport(resizeAroundCenter(viewport, size, nextSize))
  Object.assign(size, nextSize)
}

function recoverBeforeExit() {
  finishTextEditor()
  cancelGesture()
  void saveDrawing()
}

function onVisibilityChange() {
  if (document.hidden) recoverBeforeExit()
}

watch(() => props.activeTool, (tool, previous) => {
  if (tool !== 'select') linkHover.value = undefined
  if (tool !== previous && (drawPointerId !== undefined || eraserPointerId !== undefined)) cancelGesture()
  if (tool !== 'laser' && previous !== 'laser') return
  cancelGesture()
  if (tool === 'laser') {
    finishTextEditor()
    clearSelection()
    hoveredSelectionHandle.value = undefined
    isMoveReady.value = false
    isHoveringSelectedShape.value = false
  }
})

watch(drawingTitle, () => queueSave(copyScene()))

onMounted(async () => {
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('copy', onClipboard)
  document.addEventListener('cut', onClipboard)
  document.addEventListener('paste', onClipboard)
  window.addEventListener('beforeunload', warnUnsaved)
  window.addEventListener('online', saveDrawing)
  const scene = await loadDrawing()
  if (scene) {
    restoreGestureScene(scene)
    history.splice(0, history.length, copyScene(scene))
    historyIndex = 0
    historyVersion.value += 1
  }
  await nextTick()
  if (!root.value) return
  const bounds = root.value.getBoundingClientRect()
  onResize(bounds.width, bounds.height)
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) onResize(entry.contentRect.width, entry.contentRect.height)
  })
  resizeObserver.observe(root.value)
  window.addEventListener('blur', cancelGesture)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('pagehide', recoverBeforeExit)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('copy', onClipboard)
  document.removeEventListener('cut', onClipboard)
  document.removeEventListener('paste', onClipboard)
  window.removeEventListener('beforeunload', warnUnsaved)
  window.removeEventListener('online', saveDrawing)
  resizeObserver?.disconnect()
  window.removeEventListener('blur', cancelGesture)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('pagehide', recoverBeforeExit)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.clearTimeout(announceTimer)
  if (viewportFrame !== undefined) window.cancelAnimationFrame(viewportFrame)
})
</script>

<template>
  <section
    ref="root"
    class="infinite-canvas"
    :class="cursorClass"
    :style="rotationCursorStyle"
    tabindex="0"
    role="application"
    :aria-label="`Drawing canvas, ${selectionCount} objects selected`"


    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="finishPointer"
    @pointercancel="cancelPointer"
    @lostpointercapture="cancelPointer"
    @pointerleave="linkHover = undefined"
    @dblclick="onDoubleClick"
    @wheel="onWheel"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <input ref="fileInput" class="image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="onImageInput" />
    <svg
      class="canvas-surface"
      width="100%"
      height="100%"
      role="listbox"
      :aria-label="`Drawing objects, ${selectionCount} of ${allShapes.length} selected`"
      aria-multiselectable="true"
    >
      <defs>
        <pattern
          id="sparse-dot-pattern"
          patternUnits="userSpaceOnUse"
          :x="patternX"
          :y="patternY"
          :width="spacing"
          :height="spacing"
        >
          <circle cx="0" cy="0" r="1" class="guide-dot" />
        </pattern>
        <clipPath v-for="image in rectangles.filter(isImage)" :id="`image-clip-${image.id}`" :key="`image-clip-${image.id}`" clipPathUnits="userSpaceOnUse">
          <rect :x="image.x" :y="image.y" :width="image.width" :height="image.height" :rx="image.cornerRadius" :ry="image.cornerRadius" />
        </clipPath>
      </defs>
      <rect width="100%" height="100%" fill="url(#sparse-dot-pattern)" />
      <g :transform="`translate(${viewport.translationX} ${viewport.translationY}) scale(${viewport.scale})`">
        <g
          v-for="(object, index) in allShapes"
          :key="object.id"
          role="option"
          :aria-label="shapeLabel(object)"
          :aria-posinset="index + 1"
          :aria-setsize="allShapes.length"
          :aria-selected="selectedShapeIds.includes(object.id)"
          :class="{ 'will-erase': erasedShapeIds.includes(object.id) }"
        >
        <path
          v-for="draw in isFreeDraw(object) ? [object] : []"
          :key="draw.id"
          :d="freeDrawPath(draw)"
          class="free-draw"
          :style="shapeStyle(draw)"
        />
        <path
          v-for="line in isLine(object) ? [object] : []"
          :key="line.id"
          :d="linePath(line)"
          class="drawn-line"
          :style="shapeStyle(line)"
        />
        <path
          v-if="isLine(object) && object.kind === 'arrow'"
          :d="lineArrowHeadPath(object, 8 / viewport.scale)"
          class="drawn-arrowhead"
          :style="{ fill: object.arrowHeadFill ?? shapeStyle(object).stroke, opacity: object.opacity ?? 1 }"
        />
        <g
          v-for="image in !isLine(object) && isImage(object) ? [object] : []"
          :key="image.id"
          :transform="`rotate(${image.rotation} ${image.x + image.width / 2} ${image.y + image.height / 2})`"
          :clip-path="`url(#image-clip-${image.id})`"
        >
          <svg
            v-if="image.crop"
            :x="image.x"
            :y="image.y"
            :width="image.width"
            :height="image.height"
            :viewBox="`${image.crop.x} ${image.crop.y} ${image.crop.width} ${image.crop.height}`"
            preserveAspectRatio="none"
          ><image :href="image.src" :width="image.naturalWidth" :height="image.naturalHeight" class="drawn-image" :style="shapeStyle(image)" /></svg>
          <image
            v-else
            :x="image.x"
            :y="image.y"
            :width="image.width"
            :height="image.height"
            :href="image.src"
            preserveAspectRatio="none"
            class="drawn-image"
            :style="shapeStyle(image)"
          />
          <rect :x="image.x" :y="image.y" :width="image.width" :height="image.height" :rx="image.cornerRadius" :ry="image.cornerRadius" class="drawn-image-border" :style="shapeStyle(image)" />
        </g>
        <g
          v-for="diamond in !isLine(object) && isDiamond(object) ? [object] : []"
          :key="diamond.id"
          :transform="`rotate(${diamond.rotation} ${diamond.x + diamond.width / 2} ${diamond.y + diamond.height / 2})`"
        >
          <path
            :d="diamondPath(diamond)"
            class="drawn-diamond"
            :style="shapeStyle(diamond)"
          />
          <text
            v-if="diamond.label && textEditor?.shapeId !== diamond.id"
            :x="diamond.x + diamond.width / 2"
            :y="diamond.y + diamond.height / 2"
            :font-size="diamond.labelFontSize ?? 16"
            class="shape-label"
            :style="{ fill: diamond.labelFill ?? 'var(--ink-gray-9, #171717)', fontFamily: TEXT_FONT_FAMILIES[diamond.labelFontFamily ?? 'shantell'], fontWeight: diamond.labelFontWeight ?? 400, fontStyle: diamond.labelFontStyle ?? 'normal', textDecoration: diamond.labelTextDecoration ?? 'none', textAnchor: labelTextAlign(diamond) === 'center' ? 'middle' : labelTextAlign(diamond) === 'right' ? 'end' : 'start' }"
          >
            <tspan
              v-for="(line, index) in labelLines(diamond)"
              :key="index"
              :x="labelLineX(diamond)"
              :dy="index === 0 ? -(labelLines(diamond).length - 1) * (diamond.labelFontSize ?? 16) * 0.625 : (diamond.labelFontSize ?? 16) * 1.25"
              :textLength="labelTextAlign(diamond) === 'justify' && index < labelLines(diamond).length - 1 ? labelTextWidth(diamond) : undefined"
              lengthAdjust="spacing"
            >{{ line }}</tspan>
          </text>
        </g>
        <g
          v-for="rectangle in !isLine(object) && !isFreeDraw(object) && !isEllipse(object) && !isDiamond(object) && !isText(object) && !isImage(object) ? [object] : []"
          :key="rectangle.id"
          :transform="`rotate(${rectangle.rotation} ${rectangle.x + rectangle.width / 2} ${rectangle.y + rectangle.height / 2})`"
        >
          <rect
          :x="rectangle.x"
          :y="rectangle.y"
          :width="rectangle.width"
          :height="rectangle.height"
          :rx="rectangle.cornerRadius"
          :ry="rectangle.cornerRadius"
          class="drawn-rectangle"
          :style="shapeStyle(rectangle)"
          />
          <text
            v-if="rectangle.label && textEditor?.shapeId !== rectangle.id"
            :x="rectangle.x + rectangle.width / 2"
            :y="rectangle.y + rectangle.height / 2"
            :font-size="rectangle.labelFontSize ?? 16"
            class="shape-label"
            :style="{ fill: rectangle.labelFill ?? 'var(--ink-gray-9, #171717)', fontFamily: TEXT_FONT_FAMILIES[rectangle.labelFontFamily ?? 'shantell'], fontWeight: rectangle.labelFontWeight ?? 400, fontStyle: rectangle.labelFontStyle ?? 'normal', textDecoration: rectangle.labelTextDecoration ?? 'none', textAnchor: labelTextAlign(rectangle) === 'center' ? 'middle' : labelTextAlign(rectangle) === 'right' ? 'end' : 'start' }"
          >
            <tspan
              v-for="(line, index) in labelLines(rectangle)"
              :key="index"
              :x="labelLineX(rectangle)"
              :dy="index === 0 ? -(labelLines(rectangle).length - 1) * (rectangle.labelFontSize ?? 16) * 0.625 : (rectangle.labelFontSize ?? 16) * 1.25"
              :textLength="labelTextAlign(rectangle) === 'justify' && index < labelLines(rectangle).length - 1 ? labelTextWidth(rectangle) : undefined"
              lengthAdjust="spacing"
            >{{ line }}</tspan>
          </text>
        </g>
        <g
          v-for="ellipse in !isLine(object) && isEllipse(object) ? [object] : []"
          :key="ellipse.id"
          :transform="`rotate(${ellipse.rotation} ${ellipse.x + ellipse.width / 2} ${ellipse.y + ellipse.height / 2})`"
        >
          <ellipse
          :cx="ellipse.x + ellipse.width / 2"
          :cy="ellipse.y + ellipse.height / 2"
          :rx="ellipse.width / 2"
          :ry="ellipse.height / 2"
          class="drawn-ellipse"
          :style="shapeStyle(ellipse)"
          />
          <text
            v-if="ellipse.label && textEditor?.shapeId !== ellipse.id"
            :x="ellipse.x + ellipse.width / 2"
            :y="ellipse.y + ellipse.height / 2"
            :font-size="ellipse.labelFontSize ?? 16"
            class="shape-label"
            :style="{ fill: ellipse.labelFill ?? 'var(--ink-gray-9, #171717)', fontFamily: TEXT_FONT_FAMILIES[ellipse.labelFontFamily ?? 'shantell'], fontWeight: ellipse.labelFontWeight ?? 400, fontStyle: ellipse.labelFontStyle ?? 'normal', textDecoration: ellipse.labelTextDecoration ?? 'none', textAnchor: labelTextAlign(ellipse) === 'center' ? 'middle' : labelTextAlign(ellipse) === 'right' ? 'end' : 'start' }"
          >
            <tspan
              v-for="(line, index) in labelLines(ellipse)"
              :key="index"
              :x="labelLineX(ellipse)"
              :dy="index === 0 ? -(labelLines(ellipse).length - 1) * (ellipse.labelFontSize ?? 16) * 0.625 : (ellipse.labelFontSize ?? 16) * 1.25"
              :textLength="labelTextAlign(ellipse) === 'justify' && index < labelLines(ellipse).length - 1 ? labelTextWidth(ellipse) : undefined"
              lengthAdjust="spacing"
            >{{ line }}</tspan>
          </text>
        </g>
        <g
          v-for="text in !isLine(object) && isText(object) ? [object] : []"
          :key="text.id"
          v-show="textEditor?.shapeId !== text.id"
          :transform="`rotate(${text.rotation} ${text.x + text.width / 2} ${text.y + text.height / 2})`"
        >
          <rect
            v-if="text.backgroundColor"
            :x="text.x"
            :y="text.y"
            :width="text.width"
            :height="text.height"
            :rx="text.cornerRadius"
            :ry="text.cornerRadius"
            :style="{ fill: text.backgroundColor, opacity: text.opacity ?? 1 }"
          />
          <text
            :x="textX(text)"
            :y="text.y + (textLayouts.get(text.id)?.baseline ?? text.fontSize)"
            :font-size="text.fontSize"
            class="drawn-text"
            :style="{ fill: text.fill ?? 'var(--ink-gray-9, #171717)', opacity: text.opacity ?? 1, fontFamily: TEXT_FONT_FAMILIES[text.fontFamily ?? 'shantell'], fontWeight: text.fontWeight ?? 400, fontStyle: text.fontStyle ?? 'normal', textDecoration: text.textDecoration ?? 'none', textAnchor: text.textAlign === 'center' ? 'middle' : text.textAlign === 'right' ? 'end' : 'start' }"
          >
            <tspan v-for="(line, index) in textLayouts.get(text.id)?.lines" :key="index" :x="textX(text)" :dy="index ? text.fontSize * 1.25 : 0" :textLength="text.textAlign === 'justify' && index < (textLayouts.get(text.id)?.lines.length ?? 0) - 1 ? text.width : undefined" lengthAdjust="spacing">{{ line }}</tspan>
          </text>
        </g>
        </g>
        <path
          v-if="pendingRectangle && isDiamond(pendingRectangle)"
          :d="diamondPath(pendingRectangle)"
          class="drawn-diamond is-pending"
        />
        <rect
          v-if="pendingRectangle && !isEllipse(pendingRectangle) && !isDiamond(pendingRectangle)"
          :x="pendingRectangle.x"
          :y="pendingRectangle.y"
          :width="pendingRectangle.width"
          :height="pendingRectangle.height"
          :rx="pendingRectangle.cornerRadius"
          :ry="pendingRectangle.cornerRadius"
          class="drawn-rectangle is-pending"
        />
        <ellipse
          v-if="pendingRectangle && isEllipse(pendingRectangle)"
          :cx="pendingRectangle.x + pendingRectangle.width / 2"
          :cy="pendingRectangle.y + pendingRectangle.height / 2"
          :rx="pendingRectangle.width / 2"
          :ry="pendingRectangle.height / 2"
          class="drawn-ellipse is-pending"
        />
        <path
          v-if="pendingLine"
          :d="linePath(pendingLine)"
          class="drawn-line is-pending"
        />
        <path v-if="pendingDraw" :d="freeDrawPath(pendingDraw)" class="free-draw" :style="shapeStyle(pendingDraw)" />
        <path
          v-if="pendingLine?.kind === 'arrow'"
          :d="lineArrowHeadPath(pendingLine, 8 / viewport.scale)"
          class="drawn-arrowhead is-pending"
          :style="{ fill: pendingLine.stroke ?? '#171717', opacity: pendingLine.opacity ?? 1 }"
        />
        <rect
          v-if="pendingText"
          :x="pendingText.x"
          :y="pendingText.y"
          :width="pendingText.width"
          :height="pendingText.height"
          class="text-box-preview"
        />
        <SnapGuides
          :alignment-guides="alignmentGuides"
          :spacing-markers="spacingMarkers"
          :scale="viewport.scale"
        />
        <g
          v-if="croppingImage && cropFrame"
          class="crop-overlay"
          :transform="`rotate(${croppingImage.rotation} ${croppingImage.x + croppingImage.width / 2} ${croppingImage.y + croppingImage.height / 2})`"
        >
          <image
            :x="cropSourceBounds(croppingImage).x"
            :y="cropSourceBounds(croppingImage).y"
            :width="cropSourceBounds(croppingImage).width"
            :height="cropSourceBounds(croppingImage).height"
            :href="croppingImage.src"
            preserveAspectRatio="none"
            class="crop-image-preview"
          />
          <path :d="cropMaskPath(croppingImage, cropFrame)" fill-rule="evenodd" class="crop-mask" />
          <rect :x="cropFrame.x" :y="cropFrame.y" :width="cropFrame.width" :height="cropFrame.height" class="crop-frame" />
        </g>
        <g v-if="selectedLine && !hasMultipleSelection" class="selection-overlay">
          <path
            :d="linePath(selectedLine)"
            class="selection-line"
          />
          <circle :cx="selectedLine.start.x" :cy="selectedLine.start.y" :r="3 / viewport.scale" class="selection-handle" />
          <circle :cx="selectedLine.end.x" :cy="selectedLine.end.y" :r="3 / viewport.scale" class="selection-handle" />
          <circle
            :cx="lineControlPoint(selectedLine).x"
            :cy="lineControlPoint(selectedLine).y"
            :r="(hoveredSelectionHandle === 'line-curve' ? 4 : 3) / viewport.scale"
            class="curve-handle"
          />
        </g>
        <g
          v-if="selectionFrame && selectionCorners && selectionEdges"
          class="selection-overlay"
          :class="{ 'is-text-selection': isTextSelected, 'is-multiple-selection': hasMultipleSelection }"
        >
          <rect
            v-for="item in selectionItemFrames"
            :key="`selection-item-${item.id}`"
            :x="item.x"
            :y="item.y"
            :width="item.width"
            :height="item.height"
            :transform="`rotate(${item.rotation} ${item.x + item.width / 2} ${item.y + item.height / 2})`"
            class="selection-item-outline"
          />
          <rect
            :x="selectionFrame.x"
            :y="selectionFrame.y"
            :width="selectionFrame.width"
            :height="selectionFrame.height"
            :transform="`rotate(${selectionFrame.rotation} ${selectionFrame.x + selectionFrame.width / 2} ${selectionFrame.y + selectionFrame.height / 2})`"
            class="selection-outline"
          />
          <circle
            v-for="(corner, name) in selectionCorners"
            :key="name"
            :cx="corner.x"
            :cy="corner.y"
            :r="(hoveredSelectionHandle === name ? 4 : 3) / viewport.scale"
            class="selection-handle"
            :class="{ 'is-highlighted': hoveredSelectionHandle === name }"
          />
          <template v-if="isTextSelected">
            <rect
              v-for="edge in [selectionEdges.east, selectionEdges.west]"
              :key="`${edge.x}-${edge.y}`"
              :x="edge.x - 2 / viewport.scale"
              :y="edge.y - 4 / viewport.scale"
              :width="4 / viewport.scale"
              :height="8 / viewport.scale"
              :rx="2 / viewport.scale"
              :transform="`rotate(${selectionFrame.rotation} ${edge.x} ${edge.y})`"
              class="selection-handle"
            />
          </template>
          <template v-else>
            <circle
              v-for="(edge, name) in selectionEdges"
              :key="name"
              :cx="edge.x"
              :cy="edge.y"
              :r="(hoveredSelectionHandle === name ? 4 : 3) / viewport.scale"
              class="selection-handle"
              :class="{ 'is-highlighted': hoveredSelectionHandle === name }"
            />
          </template>
          <circle
            v-if="showCurveControls"
            v-for="(curve, name) in visibleCurveHandles"
            :key="`curve-${name}`"
            :cx="curve.x"
            :cy="curve.y"
            :r="curveHandleRadius"
            class="curve-handle"
          />
        </g>
        <rect v-if="marquee" :x="marquee.x" :y="marquee.y" :width="marquee.width" :height="marquee.height" fill="#4285f422" stroke="#4285f4" vector-effect="non-scaling-stroke" />
        <LaserTrail ref="laserTrail" :scale="viewport.scale" />
        <LaserTrail ref="eraserTrail" :scale="viewport.scale" color="rgb(23 23 23 / 22%)" :radius="2.5" :duration="200" />
      </g>
    </svg>

    <div
      v-if="linkHover"
      class="link-hover-tooltip"
      role="tooltip"
      :style="{ left: `${linkHover.point.x}px`, top: `${linkHover.point.y - 12}px` }"
    >{{ linkHover.link }}</div>
    <p v-if="croppingImage" class="crop-hint">Drag to crop · Esc to cancel</p>

    <textarea
      v-if="textEditor"
      ref="textArea"
      v-model="textEditor.text"
      class="text-editor canvas-text-input"
      :class="{ 'is-label-editor': textEditor.kind === 'label', 'is-wrapped-editor': textEditor.wrap }"
      :style="textEditorStyle"
      :wrap="textEditor.wrap ? 'soft' : 'off'"
      aria-label="Text editor"
      spellcheck="false"
      rows="1"
      @pointerdown.stop
      @pointermove.stop
      @pointerup.stop
      @dblclick.stop
      @blur="finishTextEditor($event)"
      @input="updateTextEditor"
      @keydown="onTextEditorKeyDown"
    />

    <div v-if="propertyToolbarVisible" class="property-toolbar" role="toolbar" aria-label="Property bar" @pointerdown.capture="beginPropertyToolbarInteraction" @pointerdown.stop @click.capture="endPropertyToolbarInteraction" @dblclick.stop>
      <div class="property-color-group">
        <ShapeColorPicker
            :color="activePropertyColor ?? '#171717'"
            :secondary-color="activePropertyBorderColor"
            :stroke-width="activePropertyStrokeWidth"
            :stroke-style="activePropertyStrokeStyle"
            :show-border-options="props.activeTool !== 'draw' && !selectedLabel && Boolean(selectedShapes.length && !selectedTextShapes.length)"
            :target="propertyColorTarget"
            :mode="selectedLabel ? 'property-solid' : 'property-object'"
            :property-kind="propertyColorKind"
            label="Custom color"
            @select="applyCustomPropertyColor"
            @style="applyCustomPropertyStyle"
        />
        <template v-if="usesSolidColorPalette">
          <Button
            v-for="color in solidColors"
            :key="color.color"
            class="property-color property-color--solid"
            size="xs"
            variant="ghost"
            theme="gray"
            :label="`${color.label} color`"
            :title="`${color.label} color`"
            :aria-pressed="activePropertyColor === color.color"
            :class="{ selected: activePropertyColor === color.color }"
            :style="{ '--property-color': color.color }"
            @click="applySolidColor(color.color)"
          />
        </template>
        <template v-else>
          <Button
            v-for="color in objectColors"
            :key="color.label"
            class="property-color property-color--object"
            size="xs"
            variant="ghost"
            theme="gray"
            :label="`${color.label} fill and border`"
            :title="`${color.label} fill and border`"
            :aria-pressed="props.activeTool === 'draw' ? drawStyle.stroke === color.border && drawStyle.fill === color.fill : activePropertyColor === color.fill"
            :class="{ selected: props.activeTool === 'draw' ? drawStyle.stroke === color.border && drawStyle.fill === color.fill : activePropertyColor === color.fill }"
            :style="{ '--property-fill': color.fill, '--property-border': color.border }"
            @click="applyObjectColor(color)"
          />
        </template>
      </div>
      <template v-if="props.activeTool !== 'draw'">
        <Select
          :model-value="propertyTextStyle.fontFamily"
          :options="fontOptions"
          variant="outline"
          size="sm"
          class="property-text-control property-text-control--font"
          aria-label="Font family"
          :disabled="!textPropertyControlsEnabled"
          @update:model-value="updatePropertyTextStyle({ fontFamily: $event as TextFontFamily })"
        />
        <Select
          :model-value="propertyTextStyle.fontSize"
          :options="fontSizeOptions"
          variant="outline"
          size="sm"
          class="property-text-control property-text-control--size"
          aria-label="Font size"
          :disabled="!textPropertyControlsEnabled"
          @update:model-value="updatePropertyTextStyle({ fontSize: $event as number })"
        />
        <Tooltip text="Bold" placement="top"><Button class="property-tool" size="sm" variant="ghost" theme="gray" :class="{ 'is-active': textPropertyControlsEnabled && propertyTextStyle.fontWeight >= 600 }" label="Bold" :aria-pressed="propertyTextStyle.fontWeight >= 600" :disabled="!textPropertyControlsEnabled" @click="updatePropertyTextStyle({ fontWeight: propertyTextStyle.fontWeight >= 600 ? 400 : 600 })"><Icon :name="Bold" class="property-tool-icon" :stroke-width="1.5" /></Button></Tooltip>
        <Tooltip text="Italic" placement="top"><Button class="property-tool" size="sm" variant="ghost" theme="gray" :class="{ 'is-active': textPropertyControlsEnabled && propertyTextStyle.fontStyle === 'italic' }" label="Italic" :aria-pressed="propertyTextStyle.fontStyle === 'italic'" :disabled="!textPropertyControlsEnabled" @click="updatePropertyTextStyle({ fontStyle: propertyTextStyle.fontStyle === 'italic' ? 'normal' : 'italic' })"><Icon :name="Italic" class="property-tool-icon" :stroke-width="1.5" /></Button></Tooltip>
        <Tooltip text="Underline" placement="top"><Button class="property-tool" size="sm" variant="ghost" theme="gray" :class="{ 'is-active': textPropertyControlsEnabled && propertyTextStyle.textDecoration === 'underline' }" label="Underline" :aria-pressed="propertyTextStyle.textDecoration === 'underline'" :disabled="!textPropertyControlsEnabled" @click="updatePropertyTextStyle({ textDecoration: propertyTextStyle.textDecoration === 'underline' ? 'none' : 'underline' })"><Icon :name="Underline" class="property-tool-icon" :stroke-width="1.5" /></Button></Tooltip>
        <Tooltip :text="propertyTextAlignOption.label" placement="top"><Button class="property-tool" size="sm" variant="ghost" theme="gray" label="Text alignment" :aria-label="propertyTextAlignOption.label" :disabled="!textPropertyControlsEnabled" @click="cyclePropertyTextAlign"><Icon :name="propertyTextAlignOption.icon" class="property-tool-icon" :stroke-width="1.5" /></Button></Tooltip>
      </template>
      <Tooltip text="Bring forward" placement="top"><Button class="property-tool" size="sm" variant="ghost" theme="gray" label="Bring forward" :disabled="!selectedShapes.length || !layerActions.forward" @click="reorderSelectedShapes('forward')"><Icon :name="ChevronUp" class="property-tool-icon" :stroke-width="1.5" /></Button></Tooltip>
      <Tooltip text="Send backward" placement="top"><Button class="property-tool" size="sm" variant="ghost" theme="gray" label="Send backward" :disabled="!selectedShapes.length || !layerActions.backward" @click="reorderSelectedShapes('backward')"><Icon :name="ChevronDown" class="property-tool-icon" :stroke-width="1.5" /></Button></Tooltip>
    </div>
    <div class="history-controls" role="group" aria-label="History controls" @pointerdown.stop @dblclick.stop>
      <Button size="md" variant="ghost" theme="gray" label="Undo" title="Undo (Ctrl/⌘ Z)" :disabled="!canUndo" @click="undoScene">
        <Undo2 class="history-control-icon" aria-hidden="true" />
      </Button>
      <Button size="md" variant="ghost" theme="gray" label="Redo" title="Redo (Ctrl/⌘ Shift Z)" :disabled="!canRedo" @click="redoScene">
        <Redo2 class="history-control-icon" aria-hidden="true" />
      </Button>
    </div>
    <div class="viewport-panel" :class="{ 'is-open': minimapOpen }" @pointerdown.stop @pointermove.stop @pointerup.stop @pointercancel.stop @dblclick.stop>
    <div class="viewport-controls" role="group" aria-label="Canvas zoom and minimap controls">
            <TooltipProvider>
              <Tooltip text="Zoom out" placement="top">
                <Button
                  size="md"
                  variant="ghost"
                  theme="gray"
                  label="Zoom out"
                  :disabled="viewport.scale <= MIN_SCALE"
                  @click="stepZoom(-1)"
                >
                  <Minus class="viewport-control-icon" aria-hidden="true" />
                </Button>
              </Tooltip>
              <Tooltip text="Reset zoom to 100%" placement="top">
                <Button
                  class="zoom-reset"
                  size="md"
                  variant="ghost"
                  theme="gray"
                  label="Reset zoom to 100%"
                  @click="resetZoom"
                >
                  <span class="zoom-label">{{ zoomLabel }}</span>
                </Button>
              </Tooltip>
              <Tooltip text="Zoom in" placement="top">
                <Button
                  size="md"
                  variant="ghost"
                  theme="gray"
                  label="Zoom in"
                  :disabled="viewport.scale >= MAX_SCALE"
                  @click="stepZoom(1)"
                >
                  <Plus class="viewport-control-icon" aria-hidden="true" />
                </Button>
              </Tooltip>
              <Tooltip :text="minimapOpen ? 'Hide minimap' : 'Toggle minimap'" placement="top">
                <Button
                  class="minimap-toggle"
                  size="md"
                  variant="ghost"
                  theme="gray"
                  :label="minimapOpen ? 'Hide minimap' : 'Toggle minimap'"
                  :aria-expanded="minimapOpen"
                  aria-controls="canvas-minimap"
                  @click="minimapOpen = !minimapOpen"
                >
                  <ChevronLeft v-if="minimapOpen" class="viewport-control-icon" aria-hidden="true" />
                  <ChevronRight v-else class="viewport-control-icon" aria-hidden="true" />
                </Button>
              </Tooltip>
            </TooltipProvider>
    </div>
    <div v-if="minimapOpen" id="canvas-minimap" class="minimap-view">
      <CanvasMinimap :shapes="allShapes" :viewport="viewport" :canvas-size="size" @pan-to="panToMinimapPoint" />
    </div>
    </div>

    <p v-if="liveMessage.startsWith('Clipboard')" class="command-feedback">{{ liveMessage }}</p>
    <p class="sr-only" aria-live="polite" aria-atomic="true">{{ liveMessage }}</p>
  </section>
</template>

<style scoped>
.command-feedback { position: absolute; left: 16px; bottom: 68px; max-width: min(440px, calc(100% - 32px)); padding: 10px 12px; border-radius: 8px; background: var(--surface-base); color: var(--ink-gray-9); font-size: 13px; box-shadow: var(--shadow-sm); pointer-events: none; }
.property-toolbar {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 5px;
  right: auto;
  bottom: 16px;
  left: 50%;
  z-index: 1;
  width: max-content;
  max-width: calc(100vw - 32px);
  height: 36px;
  padding: 3px;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
  transform: translateX(-50%);
  border: 1px solid var(--outline-gray-1);
  border-radius: 10px;
  background: var(--surface-base);
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
  pointer-events: none;
}
.property-toolbar::-webkit-scrollbar { display: none; }
.property-toolbar :deep(button) { pointer-events: auto; }
.property-color-group { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; }
.property-color { width: 28px !important; height: 28px !important; padding: 0 6px; border-radius: 6px !important; }
.property-color :deep(.truncate) { display: none; }
.property-color--object { border: 2px solid var(--property-border) !important; background: var(--property-fill) !important; }
.property-color--solid { background: var(--property-color) !important; }
.property-toolbar :deep(.property-tool) { width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 6px; }
.property-toolbar :deep(.property-tool-icon) { width: 16px; height: 16px; flex: 0 0 auto; }
.property-toolbar :deep(.property-tool.is-active) { color: var(--ink-gray-8); background: var(--surface-gray-3); }
.property-toolbar :deep(.property-text-control) { flex: 0 0 auto; min-width: 0; }
.property-toolbar :deep(.property-text-control--font) { width: 124px; }
.property-toolbar :deep(.property-text-control--size) { width: 64px; }
.property-text-control :deep(button) { height: 28px; min-height: 28px; padding: 0 8px; }
:global(body:has(.property-text-control--font[data-state='open']):not(:has(.property-text-control--size[data-state='open'])) > div:has(> [data-slot='content']):not(:has(~ div [data-slot='content']))),
:global(body:has(.property-text-control--font[data-state='open']):has(.property-text-control--size[data-state='open']) > div:has(> [data-slot='content']):has(~ div [data-slot='content'])) { width: 124px !important; min-width: 0 !important; }
:global(body:has(.property-text-control--font[data-state='open']):not(:has(.property-text-control--size[data-state='open'])) > div:has(> [data-slot='content']):not(:has(~ div [data-slot='content'])) [data-slot='content']),
:global(body:has(.property-text-control--font[data-state='open']):has(.property-text-control--size[data-state='open']) > div:has(> [data-slot='content']):has(~ div [data-slot='content']) [data-slot='content']) { width: 124px !important; min-width: 124px; max-width: 124px; }
:global(body:has(.property-text-control--size[data-state='open']) > div:has(> [data-slot='content']):not(:has(~ div [data-slot='content']))) { width: 64px !important; min-width: 0 !important; }
:global(body:has(.property-text-control--size[data-state='open']) > div:has(> [data-slot='content']):not(:has(~ div [data-slot='content'])) [data-slot='content']) { width: 64px !important; min-width: 64px; max-width: 64px; }
:global(body:has(.property-text-control--font[data-state='open']) > div:has(> [data-slot='content'])),
:global(body:has(.property-text-control--size[data-state='open']) > div:has(> [data-slot='content'])) { bottom: 50px !important; height: auto !important; min-height: 0 !important; max-height: calc(100vh - 72px) !important; }
:global(body:has(.property-text-control--size[data-state='open']) > div:has(> [data-slot='content']):not(:has(~ div [data-slot='content'])) [data-slot='content'] .lucide-check) { display: none; }
@media (max-width: 600px) {
  .property-toolbar { right: 16px; bottom: 64px; left: 16px; width: auto; transform: none; }
  .property-toolbar :deep(.property-text-control--font) { width: 104px; }
  .property-toolbar :deep(.property-text-control--size) { width: 52px; }
}
@media (max-width: 600px) {
  :global(body:has(.property-text-control--font[data-state='open']) > div:has(> [data-slot='content'])),
  :global(body:has(.property-text-control--size[data-state='open']) > div:has(> [data-slot='content'])) { bottom: 98px !important; }
}
.history-controls {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 36px;
  padding: 3px;
  border: 1px solid var(--outline-gray-1);
  border-radius: 10px;
  background: var(--surface-base);
  box-shadow: var(--shadow-sm);
}

.history-controls :deep(button) {
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
}

.history-control-icon {
  width: 16px;
  height: 16px;
  stroke-width: 1.5;
}

.infinite-canvas {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  outline: none;
  background: var(--surface-base);
  cursor: default;
  user-select: none;
  --selection-blue: #4285f4;
}

.infinite-canvas.is-pan-ready {
  cursor: grab;
}

.infinite-canvas.is-panning {
  cursor: grabbing;
}

.infinite-canvas.is-drawing-shape {
  cursor: crosshair;
}

.infinite-canvas.is-text-ready {
  cursor: crosshair;
}

.infinite-canvas.is-rotation-ready {
  cursor: grab;
}

.infinite-canvas.is-rotating {
  cursor: grabbing;
}

.infinite-canvas.is-curve-ready {
  cursor: grab;
}

.infinite-canvas.is-curving {
  cursor: grabbing;
}

.infinite-canvas.is-move-ready {
  cursor: move;
}

.infinite-canvas.is-resize-ns {
  cursor: ns-resize;
}

.infinite-canvas.is-resize-ew {
  cursor: ew-resize;
}

.infinite-canvas.is-resize-nwse {
  cursor: nwse-resize;
}

.infinite-canvas.is-resize-nesw {
  cursor: nesw-resize;
}

.infinite-canvas.is-laser-ready {
  cursor: url('../assets/laser-pointer.svg') 2 2, crosshair;
}

.canvas-surface {
  position: absolute;
  inset: 0;
  display: block;
  background: var(--surface-white);
  pointer-events: none;
}

.image-input { display: none; }

.link-hover-tooltip { position: absolute; z-index: 3; max-width: min(280px, calc(100% - 32px)); padding: 6px 10px; overflow: hidden; border-radius: 7px; background: #171717; color: #fff; font-size: 13px; font-weight: 600; line-height: 20px; text-align: center; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; transform: translate(-50%, -100%); }
.link-hover-tooltip::after { position: absolute; bottom: -5px; left: 50%; width: 10px; height: 10px; background: #171717; content: ''; transform: translateX(-50%) rotate(45deg); }
.crop-hint { position: absolute; top: 72px; left: 50%; z-index: 3; margin: 0; padding: 7px 10px; border-radius: 7px; background: var(--surface-base); box-shadow: var(--shadow-sm); color: var(--ink-gray-8); font-size: 13px; line-height: 20px; pointer-events: none; transform: translateX(-50%); }

.drawn-rectangle,
.drawn-diamond,
.drawn-ellipse,
.drawn-line,
.free-draw,
.drawn-image-border {
  fill: none;
  stroke: #171717;
  stroke-width: 1.5px;
  vector-effect: non-scaling-stroke;
}

.drawn-line,
.free-draw {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.will-erase { opacity: .22; transition: opacity 180ms ease-out; }
.infinite-canvas.is-erasing { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Ccircle cx='6' cy='6' r='4.5' fill='white' fill-opacity='.8' stroke='%23171717' stroke-opacity='.55'/%3E%3C/svg%3E") 6 6, crosshair; }

.drawn-image-border { fill: none; }

.crop-mask { fill: rgb(0 0 0 / 42%); fill-rule: evenodd; }
.crop-frame { fill: none; stroke: var(--selection-blue); stroke-width: 1px; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }

.drawn-text,
.shape-label {
  fill: var(--ink-gray-9, #171717);
  font-family: InterVar, ui-sans-serif, system-ui, sans-serif;
  dominant-baseline: alphabetic;
  white-space: pre;
}

.shape-label {
  text-anchor: middle;
  dominant-baseline: middle;
}

.text-editor {
  position: absolute;
  z-index: 2;
  outline: 0 !important;
  box-shadow: none !important;
  background: transparent;
  color: var(--ink-gray-9, #171717);
  font-family: InterVar, ui-sans-serif, system-ui, sans-serif;
  border-radius: 0;
  user-select: text;
  touch-action: auto;
}

.text-editor:focus {
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
}

.text-editor.is-wrapped-editor {
  white-space: pre-wrap;
  outline: 1px dashed var(--outline-gray-3) !important;
  outline-offset: 4px;
}

.text-editor.is-label-editor {
  text-align: center;
  box-sizing: border-box;
  overflow: hidden;
  padding: 0;
  resize: none;
  outline: 0 !important;
}

.text-box-preview {
  fill: rgb(66 133 244 / 6%);
  stroke: var(--selection-blue);
  stroke-dasharray: 4 3;
  stroke-width: 1px;
}

.drawn-diamond.is-pending,
.drawn-rectangle.is-pending,
.drawn-ellipse.is-pending,
.drawn-line.is-pending {
  stroke-dasharray: 4 3;
}

.selection-outline {
  fill: none;
  stroke: var(--selection-blue);
  stroke-width: 1px;
}

.selection-item-outline {
  fill: none;
  stroke: var(--selection-blue);
  stroke-width: 1px;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.selection-outline,
.selection-handle,
.curve-handle,
.text-box-preview {
  vector-effect: non-scaling-stroke;
}

.selection-line {
  fill: none;
  stroke: var(--selection-blue);
  stroke-width: 6px;
  stroke-opacity: 0.2;
  vector-effect: non-scaling-stroke;
}

.selection-handle {
  fill: var(--surface-white, #fff);
  stroke: var(--selection-blue);
  stroke-width: 1px;
  transition: fill 100ms ease;
}

.selection-handle.is-highlighted {
  fill: var(--selection-blue);
}

.selection-rotate-control {
  position: absolute;
  z-index: 1;
  display: flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--selection-blue);
  border-radius: 50%;
  background: var(--surface-base);
  color: var(--selection-blue);
  pointer-events: none;
  transform: translate(-50%, -50%);
  transition: background-color 100ms ease, color 100ms ease;
}

.selection-rotate-control.is-highlighted {
  background: var(--selection-blue);
  color: var(--surface-white, #fff);
}

.selection-rotate-icon {
  width: 13px;
  height: 13px;
}

.curve-handle {
  fill: var(--surface-white, #fff);
  stroke: var(--selection-blue);
  stroke-width: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .selection-handle {
    transition: none;
  }
}

.guide-dot {
  fill: var(--ink-gray-4);
  fill-opacity: 0.55;
}

.viewport-panel {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 1;
  border: 1px solid var(--outline-gray-1);
  border-radius: 10px;
  background: var(--surface-base);
  box-shadow: var(--shadow-sm);
}
.viewport-panel.is-open {
  width: 168px;
  overflow: hidden;
}
.viewport-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  height: 36px;
  padding: 3px;
}
.minimap-view { display: flex; justify-content: center; padding: 0 11px 11px; }

.viewport-controls :deep(button) {
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
}

.viewport-controls :deep(.zoom-reset) {
  width: 56px;
}

.zoom-label {
  min-width: 40px;
  color: var(--ink-gray-8);
  font-family: InterVar, ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  font-weight: normal;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.viewport-control-icon {
  width: 16px;
  height: 16px;
  stroke-width: 1.5;
}

@media (pointer: coarse) {
  .viewport-panel.is-open { width: 224px; }
  .property-toolbar,
  .history-controls,
  .viewport-controls {
    height: 52px;
  }

  .property-toolbar :deep(.property-color),
  .property-toolbar :deep(.property-tool),
  .property-toolbar :deep(.color-trigger--property),
  .history-controls :deep(button),
  .viewport-controls :deep(button) {
    width: 44px !important;
    min-width: 44px;
    height: 44px !important;
    min-height: 44px;
  }

  .property-text-control :deep(button) {
    height: 44px;
    min-height: 44px;
  }

  .viewport-controls :deep(.zoom-reset) {
    width: 56px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .infinite-canvas,
  .infinite-canvas * {
    transition: none !important;
  }
}
</style>
