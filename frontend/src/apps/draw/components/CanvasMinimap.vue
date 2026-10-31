<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { screenToWorld, type Point, type Viewport } from '../canvas/geometry'
import {
  diamondPath,
  freeDrawPath,
  isClosedFreeDraw,
  linePath,
  type ImageShape,
  type RectangleShape,
  type TextShape,
} from '../canvas/scene'
import { bounds, isFreeDraw, isLine, type Shape } from '../canvas/selection'
import { layoutText, TEXT_FONT_FAMILIES } from '../canvas/text-layout'
import ArrowShape from './ArrowShape.vue'

const props = defineProps<{
  shapes: Shape[]
  viewport: Viewport
  canvasSize: Point
}>()
const emit = defineEmits<{ panTo: [point: Point] }>()
const svg = ref<SVGSVGElement>()

const width = 160
const height = 96
const visible = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | undefined
let anchor: { x: number; y: number; width: number; height: number } | undefined
let anchorScale = props.viewport.scale
const viewportBounds = computed(() => {
  const topLeft = screenToWorld({ x: 0, y: 0 }, props.viewport)
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: props.canvasSize.x / props.viewport.scale,
    height: props.canvasSize.y / props.viewport.scale,
  }
})
watch(viewportBounds, (current) => {
  if (current.width <= 0 || current.height <= 0) return
  if (!anchor) {
    anchor = { ...current }
    anchorScale = props.viewport.scale
    return
  }
  const overlapWidth = Math.max(
    0,
    Math.min(anchor.x + anchor.width, current.x + current.width) - Math.max(anchor.x, current.x),
  )
  const overlapHeight = Math.max(
    0,
    Math.min(anchor.y + anchor.height, current.y + current.height) - Math.max(anchor.y, current.y),
  )
  const zoomChanged = Math.abs(props.viewport.scale - anchorScale) > 0.3
  if (!zoomChanged && overlapWidth * overlapHeight >= (current.width * current.height) / 2) return
  anchor = { ...current }
  anchorScale = props.viewport.scale
  visible.value = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    visible.value = false
  }, 3000)
})
watch(
  () => [props.canvasSize.x, props.canvasSize.y],
  () => {
    anchor = undefined
    visible.value = false
    clearTimeout(hideTimer)
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => clearTimeout(hideTimer))

const viewBox = computed(() => {
  const scene = bounds(props.shapes) ?? viewportBounds.value
  const view = viewportBounds.value
  const x = Math.min(scene.x, view.x)
  const y = Math.min(scene.y, view.y)
  const content = {
    x,
    y,
    width: Math.max(scene.x + scene.width, view.x + view.width) - x,
    height: Math.max(scene.y + scene.height, view.y + view.height) - y,
  }
  const paddedWidth = Math.max(content.width * 1.16, 64)
  const paddedHeight = Math.max(content.height * 1.16, (64 * height) / width)
  const scale = Math.max(paddedWidth / width, paddedHeight / height)
  const boxWidth = width * scale
  const boxHeight = height * scale
  return {
    x: content.x + (content.width - boxWidth) / 2,
    y: content.y + (content.height - boxHeight) / 2,
    width: boxWidth,
    height: boxHeight,
  }
})
const viewBoxValue = computed(() => {
  const box = viewBox.value
  return `${box.x} ${box.y} ${box.width} ${box.height}`
})
const worldPerPixel = computed(() => viewBox.value.width / width)
const textLayouts = computed(
  () =>
    new Map(
      props.shapes
        .filter(isText)
        .map((shape) => [
          shape.id,
          layoutText(shape.text, shape.width, shape.fontSize, shape.wrap, shape),
        ]),
    ),
)
const labelLayouts = computed(
  () =>
    new Map(
      props.shapes
        .filter(
          (shape): shape is RectangleShape =>
            !isLine(shape) && !isFreeDraw(shape) && Boolean(shape.label),
        )
        .map((shape) => [
          shape.id,
          layoutText(shape.label ?? '', labelWidth(shape), shape.labelFontSize ?? 16, true, {
            fontFamily: shape.labelFontFamily,
          }),
        ]),
    ),
)

function navigateTo(event: MouseEvent) {
  const matrix = svg.value?.getScreenCTM()
  if (!matrix) return
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  emit('panTo', { x: point.x, y: point.y })
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    visible.value = false
  }, 3000)
}

function isImage(shape: Shape): shape is ImageShape {
  return 'kind' in shape && shape.kind === 'image'
}

function isText(shape: Shape): shape is TextShape {
  return 'kind' in shape && shape.kind === 'text'
}

function isDiamond(shape: Shape): boolean {
  return (shape as { kind?: string }).kind === 'diamond'
}

function isEllipse(shape: Shape): boolean {
  return (shape as { kind?: string }).kind === 'ellipse'
}

function rotation(shape: RectangleShape): string {
  return `rotate(${shape.rotation} ${shape.x + shape.width / 2} ${shape.y + shape.height / 2})`
}

function stroke(shape: Shape): string {
  return shape.stroke === null ? 'none' : (shape.stroke ?? '#171717')
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
</script>

<template>
  <Transition name="minimap-reveal">
    <svg
      v-if="visible"
      ref="svg"
      class="canvas-minimap"
      :viewBox="viewBoxValue"
      role="img"
      :aria-label="__('Drawing overview. Click to move the viewport.')"
      @click.stop="navigateTo"
    >
      <g
        v-for="shape in shapes"
        :key="shape.id"
        :opacity="shape.opacity ?? 1"
        pointer-events="none"
      >
        <template v-if="isLine(shape)">
          <ArrowShape
            v-if="shape.kind === 'arrow'"
            :shape="shape"
            :gradient-id="`minimap-arrow-${shape.id}`"
            :scale="1 / worldPerPixel"
          />
          <path
            v-else
            class="minimap-stroke"
            :d="linePath(shape)"
            fill="none"
            :stroke="stroke(shape)"
          />
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
              :x="shape.x"
              :y="shape.y"
              :width="shape.width"
              :height="shape.height"
              :viewBox="`${shape.crop.x} ${shape.crop.y} ${shape.crop.width} ${shape.crop.height}`"
              preserveAspectRatio="none"
            >
              <image :href="shape.src" :width="shape.naturalWidth" :height="shape.naturalHeight" />
            </svg>
            <image
              v-else
              :href="shape.src"
              :x="shape.x"
              :y="shape.y"
              :width="shape.width"
              :height="shape.height"
              preserveAspectRatio="none"
            />
            <rect
              class="minimap-stroke"
              :x="shape.x"
              :y="shape.y"
              :width="shape.width"
              :height="shape.height"
              fill="none"
              :stroke="stroke(shape)"
            />
          </template>
          <template v-else-if="isText(shape)">
            <rect
              v-if="shape.backgroundColor"
              :x="shape.x"
              :y="shape.y"
              :width="shape.width"
              :height="shape.height"
              :fill="shape.backgroundColor"
            />
            <text
              :x="textX(shape)"
              :y="shape.y + (textLayouts.get(shape.id)?.baseline ?? shape.fontSize)"
              :font-size="shape.fontSize"
              :fill="shape.fill ?? '#171717'"
              :font-family="TEXT_FONT_FAMILIES[shape.fontFamily ?? 'shantell']"
              :font-weight="shape.fontWeight ?? 400"
              :font-style="shape.fontStyle ?? 'normal'"
              :text-decoration="shape.textDecoration ?? 'none'"
              :text-anchor="
                shape.textAlign === 'center'
                  ? 'middle'
                  : shape.textAlign === 'right'
                    ? 'end'
                    : 'start'
              "
            >
              <tspan
                v-for="(line, index) in textLayouts.get(shape.id)?.lines"
                :key="index"
                :x="textX(shape)"
                :dy="index ? shape.fontSize * 1.25 : 0"
                :textLength="
                  shape.textAlign === 'justify' &&
                  index < (textLayouts.get(shape.id)?.lines.length ?? 0) - 1
                    ? shape.width
                    : undefined
                "
                lengthAdjust="spacing"
              >
                {{ line }}
              </tspan>
            </text>
          </template>
          <path
            v-else-if="isDiamond(shape)"
            class="minimap-stroke"
            :d="diamondPath(shape)"
            :fill="fill(shape)"
            :stroke="stroke(shape)"
          />
          <ellipse
            v-else-if="isEllipse(shape)"
            class="minimap-stroke"
            :cx="shape.x + shape.width / 2"
            :cy="shape.y + shape.height / 2"
            :rx="shape.width / 2"
            :ry="shape.height / 2"
            :fill="fill(shape)"
            :stroke="stroke(shape)"
          />
          <rect
            v-else
            class="minimap-stroke"
            :x="shape.x"
            :y="shape.y"
            :width="shape.width"
            :height="shape.height"
            :rx="shape.cornerRadius"
            :fill="fill(shape)"
            :stroke="stroke(shape)"
          />
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
              :dy="
                index
                  ? (shape.labelFontSize ?? 16) * 1.25
                  : -((labelLayouts.get(shape.id)?.lines.length ?? 1) - 1) *
                    (shape.labelFontSize ?? 16) *
                    0.625
              "
            >
              {{ line }}
            </tspan>
          </text>
        </g>
      </g>
      <rect
        class="minimap-viewport"
        :x="viewportBounds.x"
        :y="viewportBounds.y"
        :width="viewportBounds.width"
        :height="viewportBounds.height"
      />
    </svg>
  </Transition>
</template>

<style scoped>
.canvas-minimap {
  display: block;
  position: absolute;
  left: 0;
  bottom: calc(100% + 12px);
  width: min(160px, calc(100vw - 32px));
  height: 96px;
  overflow: hidden;
  border: 1px solid var(--outline-gray-2);
  border-radius: 12px;
  background: var(--surface-base);
  box-shadow: var(--shadow-sm);
  cursor: crosshair;
  touch-action: manipulation;
}
.minimap-viewport {
  fill: rgb(0 112 204 / 10%);
  stroke: #0070cc;
  stroke-width: 1.5px;
  vector-effect: non-scaling-stroke;
}
.minimap-reveal-enter-active,
.minimap-reveal-leave-active {
  transition: opacity 120ms ease-out;
}
.minimap-reveal-enter-from,
.minimap-reveal-leave-to {
  opacity: 0;
}
.minimap-reveal-enter-to,
.minimap-reveal-leave-from {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .minimap-reveal-enter-active,
  .minimap-reveal-leave-active {
    transition: none;
  }
}
.minimap-stroke {
  stroke-width: 1px;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
