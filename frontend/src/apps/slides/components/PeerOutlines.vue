<template>
  <div
    v-for="outline in placed"
    :key="outline.elementId"
    class="peer-colour pointer-events-none absolute z-[9998]"
    :class="{ 'opacity-50': outline.person.isIdle }"
    :style="outline.style"
    data-peer-outline
  >
    <div
      v-if="outline.label"
      class="pointer-events-auto absolute left-0 top-0 h-0 w-0 origin-top-left"
      :style="{ transform: `scale(${1 / scale})` }"
      @mouseenter="hoveredId = outline.elementId"
      @mouseleave="hoveredId = null"
    >
      <span
        class="absolute -left-1 -top-1 size-2 rounded-full bg-[var(--peer-solid)]"
        :class="{ 'opacity-0': showsName(outline) }"
        data-peer-dot
      />
      <svg
        v-if="showsName(outline)"
        class="absolute bottom-0 -left-[0.75px] overflow-visible"
        :width="tab(outline.label).width"
        height="16"
      >
        <path :d="tab(outline.label).fill" fill="var(--peer-tint)" />
        <path
          :d="tab(outline.label).stroke"
          fill="none"
          stroke="var(--peer-solid)"
          stroke-width="1.5"
        />
        <text :style="{ font: TAB_FONT }" x="6.75" y="12.5" fill="var(--peer-ink)">
          {{ outline.label }}
        </text>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch, type CSSProperties } from 'vue'

import { outlinesOn, usePeopleSelecting, type PeerOutline } from '@/apps/slides/collab/peerOutlines'
import { getElementDiv } from '@/apps/slides/stores/elementRegistry'
import { currentSlide } from '@/apps/slides/stores/slide'
import type { RoomPresence } from '@/platform/collab'
import { colourStyle } from '@/platform/collab/colours'

import '@/platform/collab/peers.css'

const NAME_SHOWN_MS = 3000
const LINE_WIDTH = 1.5
const TAB_FONT = '500 11px ui-sans-serif, -apple-system, sans-serif'

const props = defineProps<{ scale: number }>()

const people = usePeopleSelecting(inject('livePresence', shallowRef<RoomPresence | null>(null)))
// SAFETY: the untyped slide store's slides hold their elements, each with an id
const shownElements = () => (currentSlide.value?.elements ?? []) as { id: string }[]
const shownIds = computed(() => new Set(shownElements().map(({ id }) => id)))
const outlines = computed(() => outlinesOn(people.value, shownIds.value))

const hoveredId = ref<string | null>(null)
const now = ref(Date.now())
let shrinkTimer: ReturnType<typeof setTimeout> | undefined

function armShrink() {
  clearTimeout(shrinkTimer)
  now.value = Date.now()
  const ahead = people.value.flatMap(({ actedAt }) => {
    const left = actedAt + NAME_SHOWN_MS - now.value
    return left > 0 ? [left] : []
  })
  if (ahead.length) {
    shrinkTimer = setTimeout(armShrink, Math.min(...ahead))
  }
}

watch(people, armShrink)
onBeforeUnmount(() => clearTimeout(shrinkTimer))

function showsName(outline: PeerOutline) {
  return hoveredId.value === outline.elementId || now.value - outline.person.actedAt < NAME_SHOWN_MS
}

const placed = shallowRef<(PeerOutline & { style: CSSProperties })[]>([])

function place() {
  const lineWidth = LINE_WIDTH / props.scale
  placed.value = outlines.value.flatMap((outline) => {
    const element = getElementDiv(outline.elementId)
    if (!element) {
      return []
    }

    const { left, top, transform, transformOrigin } = element.style
    const style = {
      left,
      top,
      transform,
      transformOrigin,
      width: `${element.offsetWidth}px`,
      height: `${element.offsetHeight}px`,
      outline: `${lineWidth}px solid var(--peer-solid)`,
      outlineOffset: `${-lineWidth / 2}px`,
      ...(outline.person.colour && colourStyle(outline.person.colour)),
    }
    return [{ ...outline, style }]
  })
}

// after the patch, so a size the element just took is the one measured
watch([outlines, () => props.scale, () => currentSlide.value?.elements], place, {
  deep: true,
  flush: 'post',
  immediate: true,
})

const widths = new Map<string, number>()
const measurer = document.createElement('canvas').getContext('2d')

function textWidth(text: string) {
  const known = widths.get(text)
  if (known !== undefined) {
    return known
  }

  if (!measurer) {
    return 0
  }

  measurer.font = TAB_FONT
  const width = measurer.measureText(text).width
  widths.set(text, width)
  return width
}

// the approved shape: joined to the outline, with a soft curve on its right side
function tab(label: string) {
  const right = 6.75 + textWidth(label) + 6
  const inner = right - 0.75
  return {
    width: right + 4,
    stroke: `M0.75,16 L0.75,6.75 Q0.75,0.75 6.75,0.75 L${right - 6},0.75 Q${right},0.75 ${right},6.75 L${right},12 Q${right},16 ${right + 4},16`,
    fill: `M1.5,16 L1.5,6.75 Q1.5,1.5 6.75,1.5 L${right - 6},1.5 Q${inner},1.5 ${inner},6.75 L${inner},12 Q${inner},16 ${right + 4},16 Z`,
  }
}
</script>
