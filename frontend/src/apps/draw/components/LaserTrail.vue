<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue'
import type { Point } from '../canvas/geometry'

type Sample = Point & { time: number }
type Stroke = { id: number; points: Sample[] }

const props = withDefaults(defineProps<{ scale: number; color?: string; radius?: number; duration?: number }>(), {
  color: '#ff0033', radius: 1.25, duration: 1000,
})
const paths = shallowRef<{ id: number; path: string; opacity: number }[]>([])
let strokes: Stroke[] = []
let nextId = 0
let frame: number | undefined

function add(point: Point, newStroke = false, time = performance.now()) {
  if (newStroke || !strokes.length) strokes.push({ id: nextId++, points: [] })
  const points = strokes.at(-1)!.points
  const previous = points.at(-1)
  if (previous && distance(point, previous) * props.scale < 0.5) return
  points.push({ ...point, time: Math.max(time, previous?.time ?? time) })
  frame ??= requestAnimationFrame(animate)
}

function clear() {
  if (frame !== undefined) cancelAnimationFrame(frame)
  frame = undefined
  strokes = []
  paths.value = []
}

function animate(now: number) {
  const cutoff = now - props.duration
  strokes = strokes.filter((stroke) => stroke.points.at(-1)!.time > cutoff)
  paths.value = strokes.map(({ id, points }) => {
    // Keep the preceding controls so the fading tail does not change the curve.
    const firstVisible = points.findIndex((point) => point.time > cutoff)
    points.splice(0, Math.max(0, firstVisible - 2))
    return {
      id,
      path: outline(smoothPoints(points), now),
      opacity: strength(points.at(-1)!.time, now),
    }
  })
  frame = strokes.length ? requestAnimationFrame(animate) : undefined
}

function smoothPoints(points: Sample[]): Sample[] {
  const curve: Sample[] = []
  points.forEach((point, index) => {
    const start = index ? interpolate(points[index - 1], point, 0.5) : point
    const end = points[index + 1] ? interpolate(point, points[index + 1], 0.5) : point
    const steps = Math.max(1, Math.ceil((distance(start, point) + distance(point, end)) * props.scale / 2))
    for (let step = index ? 1 : 0; step <= steps; step++) {
      const t = step / steps
      curve.push(interpolate(interpolate(start, point, t), interpolate(point, end, t), t))
    }
  })
  return curve
}

function outline(curve: Sample[], now: number): string {
  const cutoff = now - props.duration
  const firstVisible = curve.findIndex((point) => point.time > cutoff)
  if (firstVisible < 0) return ''
  const points = curve.slice(firstVisible)
  if (firstVisible > 0) {
    const before = curve[firstVisible - 1]
    const after = points[0]
    points.unshift(interpolate(before, after, (cutoff - before.time) / (after.time - before.time)))
  }
  const left: Point[] = []
  const right: Point[] = []
  points.forEach((point, index) => {
    const previous = points[index - 1] ?? point
    const next = points[index + 1] ?? point
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy)
    const radius = props.radius * strength(point.time, now) / props.scale
    const normal = length ? { x: -dy / length, y: dx / length } : { x: 0, y: 1 }
    left.push({ x: point.x + normal.x * radius, y: point.y + normal.y * radius })
    right.push({ x: point.x - normal.x * radius, y: point.y - normal.y * radius })
  })
  const headRadius = props.radius * strength(points.at(-1)!.time, now) / props.scale
  const tailRadius = props.radius * strength(points[0].time, now) / props.scale
  const head = right.pop()!
  return `M ${coordinates(left[0])} ${left.slice(1).map((point) => `L ${coordinates(point)}`).join(' ')}
    A ${headRadius} ${headRadius} 0 0 0 ${coordinates(head)}
    ${right.reverse().map((point) => `L ${coordinates(point)}`).join(' ')}
    A ${tailRadius} ${tailRadius} 0 0 0 ${coordinates(left[0])} Z`
}

function strength(time: number, now: number): number {
  const remaining = Math.max(0, Math.min(1, (props.duration - (now - time)) / Math.min(500, props.duration)))
  return remaining * remaining * (3 - 2 * remaining)
}

function interpolate(a: Sample, b: Sample, t: number): Sample {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, time: a.time + (b.time - a.time) * t }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function coordinates(point: Point): string {
  return `${point.x} ${point.y}`
}

defineExpose({ add, clear })
onBeforeUnmount(clear)
</script>

<template>
  <g class="laser-trail" :style="{ fill: color }" aria-hidden="true">
    <path
      v-for="stroke in paths"
      :key="stroke.id"
      :d="stroke.path"
      :opacity="stroke.opacity"
    />
  </g>
</template>

<style scoped>
.laser-trail { pointer-events: none; }
</style>
