<script setup lang="ts">
import { computed, ref } from 'vue'
import { bounds, isFreeDraw, isLine, type Shape } from '../canvas/selection'
import { screenToWorld, type Point, type Viewport } from '../canvas/geometry'
import {
  diamondPath,
  freeDrawPath,
  isClosedFreeDraw,
  lineArrowHeadPath,
  linePath,
  type ImageShape,
  type RectangleShape,
  type TextShape,
} from '../canvas/scene'
import { layoutText, TEXT_FONT_FAMILIES } from '../canvas/text-layout'

const props = defineProps<{
  shapes: Shape[]
  viewport: Viewport
  canvasSize: Point
}>()
const emit = defineEmits<{ panTo: [point: Point] }>()

const svg = ref<SVGSVGElement>()
const width = 136
const height = 80
const viewportBounds = computed(() => {
  const topLeft = screenToWorld({ x: 0, y: 0 }, props.viewport)
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: props.canvasSize.x / props.viewport.scale,
    height: props.canvasSize.y / props.viewport.scale,
  }
})
const viewBox = computed(() => {
  const content = bounds(props.shapes) ?? viewportBounds.value
  const paddedWidth = Math.max(content.width * 1.16, 64)
  const paddedHeight = Math.max(content.height * 1.16, 64 * height / width)
  const scale = Math.max(paddedWidth / width, paddedHeight / height)
  const boxWidth = width * scale
  const boxHeight = height * scale
  return { x: content.x + (content.width - boxWidth) / 2, y: content.y + (content.height - boxHeight) / 2, width: boxWidth, height: boxHeight }
})
const viewBoxValue = computed(() => {
  const box = viewBox.value
  return `${box.x} ${box.y} ${box.width} ${box.height}`
})
const worldPerPixel = computed(() => viewBox.value.width / width)
const textLayouts = computed(() => new Map(props.shapes.filter(isText).map(shape => [
  shape.id, layoutText(shape.text, shape.width, shape.fontSize, shape.wrap, shape),
])))
const labelLayouts = computed(() => new Map(props.shapes.filter((shape): shape is RectangleShape => !isLine(shape) && !isFreeDraw(shape) && Boolean(shape.label)).map(shape => [
  shape.id, layoutText(shape.label ?? '', labelWidth(shape), shape.labelFontSize ?? 16, true, { fontFamily: shape.labelFontFamily }),
])))

function isImage(shape: Shape): shape is ImageShape {
  return 'kind' in shape && shape.kind === 'image'
}

function isText(shape: Shape): shape is TextShape {
  return 'kind' in shape && shape.kind === 'text'
}

function isDiamond(shape: Shape): boolean {
  return 'kind' in shape && shape.kind === 'diamond'
}

function isEllipse(shape: Shape): boolean {
  return 'kind' in shape && shape.kind === 'ellipse'
}

function rotation(shape: RectangleShape): string {
  return `rotate(${shape.rotation} ${shape.x + shape.width / 2} ${shape.y + shape.height / 2})`
}

function stroke(shape: Shape): string {
  return shape.stroke === null ? 'none' : shape.stroke ?? '#171717'
}

function fill(shape: RectangleShape): string {
  return shape.fill ?? 'none'
}

function labelWidth(shape: RectangleShape): number {
  const width = isDiamond(shape) || isEllipse(shape) ? shape.width / Math.SQRT2 : shape.width
  return Math.max(1, width - 24)
}

function textX(shape: TextShape): number {
  if (shape.textAlign === 'center') return shape.x + shape.width / 2
  if (shape.textAlign === 'right') return shape.x + shape.width
  return shape.x
}

function panAt(event: PointerEvent) {
  const matrix = svg.value?.getScreenCTM()
  if (!matrix) return
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  emit('panTo', { x: point.x, y: point.y })
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  svg.value?.setPointerCapture(event.pointerId)
  panAt(event)
  event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
  if (svg.value?.hasPointerCapture(event.pointerId)) panAt(event)
}
</script>

<template>
  <svg
    ref="svg"
    class="canvas-minimap"
    :viewBox="viewBoxValue"
    role="img"
    aria-label="Canvas minimap. Click or drag to move the view."
    @pointerdown.stop="onPointerDown"
    @pointermove.stop="onPointerMove"
    @pointerup.stop
    @pointercancel.stop
    @dblclick.stop
  >
    <g v-for="shape in shapes" :key="shape.id" :opacity="shape.opacity ?? 1" pointer-events="none">
      <template v-if="isLine(shape)">
        <path class="minimap-stroke" :d="linePath(shape)" fill="none" :stroke="stroke(shape)" />
        <path v-if="shape.kind === 'arrow'" :d="lineArrowHeadPath(shape, Math.max(8, worldPerPixel * 5))" :fill="shape.arrowHeadFill ?? stroke(shape)" />
      </template>
      <path
        v-else-if="isFreeDraw(shape)"
        class="minimap-stroke"
        :d="freeDrawPath(shape)"
        :stroke="stroke(shape)"
        :fill="isClosedFreeDraw(shape) ? fill(shape) : 'none'"
      />
      <g v-else :transform="rotation(shape)">
        <template v-if="isImage(shape)">
          <svg
            v-if="shape.crop"
            :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height"
            :viewBox="`${shape.crop.x} ${shape.crop.y} ${shape.crop.width} ${shape.crop.height}`"
            preserveAspectRatio="none"
          ><image :href="shape.src" :width="shape.naturalWidth" :height="shape.naturalHeight" /></svg>
          <image v-else :href="shape.src" :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" preserveAspectRatio="none" />
          <rect class="minimap-stroke" :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" fill="none" :stroke="stroke(shape)" />
        </template>
        <template v-else-if="isText(shape)">
          <rect v-if="shape.backgroundColor" :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" :fill="shape.backgroundColor" />
          <text
            :x="textX(shape)"
            :y="shape.y + (textLayouts.get(shape.id)?.baseline ?? shape.fontSize)"
            :font-size="shape.fontSize"
            :fill="shape.fill ?? '#171717'"
            :font-family="TEXT_FONT_FAMILIES[shape.fontFamily ?? 'shantell']"
            :font-weight="shape.fontWeight ?? 400"
            :font-style="shape.fontStyle ?? 'normal'"
            :text-decoration="shape.textDecoration ?? 'none'"
            :text-anchor="shape.textAlign === 'center' ? 'middle' : shape.textAlign === 'right' ? 'end' : 'start'"
          >
            <tspan
              v-for="(line, index) in textLayouts.get(shape.id)?.lines"
              :key="index"
              :x="textX(shape)"
              :dy="index ? shape.fontSize * 1.25 : 0"
              :textLength="shape.textAlign === 'justify' && index < (textLayouts.get(shape.id)?.lines.length ?? 0) - 1 ? shape.width : undefined"
              lengthAdjust="spacing"
            >{{ line }}</tspan>
          </text>
        </template>
        <path v-else-if="isDiamond(shape)" class="minimap-stroke" :d="diamondPath(shape)" :fill="fill(shape)" :stroke="stroke(shape)" />
        <ellipse v-else-if="isEllipse(shape)" class="minimap-stroke" :cx="shape.x + shape.width / 2" :cy="shape.y + shape.height / 2" :rx="shape.width / 2" :ry="shape.height / 2" :fill="fill(shape)" :stroke="stroke(shape)" />
        <rect v-else class="minimap-stroke" :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" :rx="shape.cornerRadius" :fill="fill(shape)" :stroke="stroke(shape)" />
        <text
          v-if="!isImage(shape) && !isText(shape) && shape.label"
          :x="shape.x + shape.width / 2"
          :y="shape.y + shape.height / 2"
          :font-size="shape.labelFontSize ?? 16"
          :fill="shape.labelFill ?? '#171717'"
          :font-family="TEXT_FONT_FAMILIES[shape.labelFontFamily ?? 'shantell']"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          <tspan
            v-for="(line, index) in labelLayouts.get(shape.id)?.lines"
            :key="index"
            :x="shape.x + shape.width / 2"
            :dy="index ? (shape.labelFontSize ?? 16) * 1.25 : -((labelLayouts.get(shape.id)?.lines.length ?? 1) - 1) * (shape.labelFontSize ?? 16) * 0.625"
          >{{ line }}</tspan>
        </text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.canvas-minimap {
  display: block;
  width: 136px;
  height: 80px;
  overflow: hidden;
  border-radius: 2px;
  background: transparent;
  cursor: crosshair;
  touch-action: none;
}
.minimap-stroke {
  stroke-width: 1px;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
