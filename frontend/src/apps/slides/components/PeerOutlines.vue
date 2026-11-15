<template>
  <div
    v-for="outline in placed"
    :key="outline.elementId"
    class="peer-colour pointer-events-none absolute z-[9998]"
    :class="{ 'opacity-50': outline.person.isIdle }"
    :style="outline.style"
    data-peer-outline
  >
    <!-- at screen size, so the outline's line is as wide as the tab's and meets it at any zoom -->
    <div
      class="absolute left-0 top-0 h-0 w-0 origin-top-left"
      :style="{ transform: `scale(${1 / scale})` }"
      data-peer-layer
    >
      <svg
        class="absolute left-0 top-0 overflow-visible"
        :width="outline.width"
        :height="outline.height"
      >
        <rect
          :width="outline.width"
          :height="outline.height"
          fill="none"
          stroke="var(--peer-solid)"
          :stroke-width="LINE_WIDTH"
          data-peer-line
        />
      </svg>
      <div
        v-if="outline.label"
        class="pointer-events-auto absolute left-0 top-0 h-0 w-0"
        @mouseenter="hoveredId = outline.elementId"
        @mouseleave="hoveredId = null"
      >
        <span
          class="absolute -left-1 -top-1 size-2 rounded-full bg-[var(--peer-solid)]"
          :class="showsName(outline) ? 'opacity-0' : SHRINKING"
          data-peer-dot
        />
        <!-- an element narrower than the tab's foot takes Writer's name flag, its corner on the outline's -->
        <div
          v-if="isNarrow(outline.label, outline.width)"
          class="absolute -bottom-[0.75px] -left-[0.75px] origin-bottom-left whitespace-nowrap rounded-[6px_6px_6px_1px] bg-[var(--peer-tint)] px-1.5 text-[var(--peer-ink)] shadow-[inset_0_0_0_1.5px_var(--peer-solid)]"
          :class="{ [`pointer-events-none scale-0 opacity-0 ${SHRINKING}`]: !showsName(outline) }"
          :style="{ font: TAB_FONT, lineHeight: '16px' }"
          :data-shrunk="!showsName(outline) || undefined"
          data-peer-name
        >
          {{ outline.label }}
        </div>
        <!-- shrinks into the dot, and comes back at once -->
        <svg
          v-else
          class="absolute bottom-0 left-0 origin-bottom-left overflow-visible"
          :class="{ [`pointer-events-none scale-0 opacity-0 ${SHRINKING}`]: !showsName(outline) }"
          :width="tab(outline.label).width"
          height="16"
          :data-shrunk="!showsName(outline) || undefined"
          data-peer-name
        >
          <!-- drawn 0.75px left, so its line centres on the outline's -->
          <g transform="translate(-0.75 0)">
            <path :d="tab(outline.label).fill" fill="var(--peer-tint)" />
            <path
              :d="tab(outline.label).stroke"
              fill="none"
              stroke="var(--peer-solid)"
              :stroke-width="LINE_WIDTH"
            />
            <text :style="{ font: TAB_FONT }" x="6.75" y="12.5" fill="var(--peer-ink)">
              {{ outline.label }}
            </text>
          </g>
        </svg>
      </div>
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
const SHRINKING = 'transition duration-200 ease-out motion-reduce:transition-none'

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

const placed = shallowRef<
  (PeerOutline & { style: CSSProperties; width: number; height: number })[]
>([])

function place() {
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
      ...(outline.person.colour && colourStyle(outline.person.colour)),
    }
    // on screen
    const width = element.offsetWidth * props.scale
    const height = element.offsetHeight * props.scale
    return [{ ...outline, style, width, height }]
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

// the tab's foot ends 0.75px left of its own right edge
function isNarrow(label: string, width: number) {
  return width < tab(label).width - 0.75
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
