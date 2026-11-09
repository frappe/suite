<!--
  The Suite mark: a black glass tile lit from the top left, with a flat white
  glyph. The tile is drawn in SVG with Figma's smooth corner, so the fill, the
  rim light and the shadow all follow one shape. Below 24px it is a flat tile,
  since the effects blur together. `hero` adds an entrance, a light sweep and a
  halo, for the one place the mark stands alone.
-->
<script setup lang="ts">
import { computed, useId } from 'vue'

const { size = 40, hero = false } = defineProps<{ size?: number; hero?: boolean }>()

const id = `suite-mark-${useId()}`
const small = computed(() => size < 24)
const shape = computed(() => smoothSquare(size, size * 0.26, 0.6))

// The shadow falls away from the top-left light. `drop-shadow` follows the
// smooth corner, where `box-shadow` would follow a plain rounded box.
const shadow = computed(() =>
  small.value
    ? undefined
    : `drop-shadow(0.5px 1px 0.5px rgb(0 0 0 / 0.12)) drop-shadow(${size * 0.03}px ${size * 0.06}px ${size * 0.1}px var(--mark-shadow))`,
)

/**
 * Figma's smooth corner for a square of `side`, as the corne.rs and Lisse
 * write it. Smoothing 0.6 is the value Figma calls "iOS".
 */
function smoothSquare(side: number, radius: number, smoothing: number): string {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const budget = side / 2
  const smooth = Math.min(smoothing, budget / radius - 1)
  const p = Math.min((1 + smooth) * radius, budget)
  const arcMeasure = 90 * (1 - smooth)
  const arc = Math.sin(rad(arcMeasure / 2)) * radius * Math.SQRT2
  const alpha = (90 - arcMeasure) / 2
  const p3ToP4 = radius * Math.tan(rad(alpha / 2))
  const beta = 45 * smooth
  const c = p3ToP4 * Math.cos(rad(beta))
  const d = c * Math.tan(rad(beta))
  const b = (p - arc - c - d) / 3
  const a = 2 * b
  const n = (value: number) => +value.toFixed(3)
  const r = n(radius)
  return [
    `M ${n(side - p)} 0`,
    `c ${n(a)} 0 ${n(a + b)} 0 ${n(a + b + c)} ${n(d)}`,
    `a ${r} ${r} 0 0 1 ${n(arc)} ${n(arc)}`,
    `c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(a + b + c)}`,
    `L ${n(side)} ${n(side - p)}`,
    `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(a + b + c)}`,
    `a ${r} ${r} 0 0 1 ${n(-arc)} ${n(arc)}`,
    `c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-(a + b + c))} ${n(d)}`,
    `L ${n(p)} ${n(side)}`,
    `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-(a + b + c))} ${n(-d)}`,
    `a ${r} ${r} 0 0 1 ${n(-arc)} ${n(-arc)}`,
    `c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-(a + b + c))}`,
    `L 0 ${n(p)}`,
    `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-(a + b + c))}`,
    `a ${r} ${r} 0 0 1 ${n(arc)} ${n(-arc)}`,
    `c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(a + b + c)} ${n(-d)}`,
    'Z',
  ].join(' ')
}
</script>

<template>
  <div class="mark" :class="{ hero, small }" :style="{ '--size': `${size}px` }">
    <div v-if="hero" class="halo" aria-hidden="true" />
    <div class="tile" role="img" :aria-label="__('Frappe Suite')">
      <svg :viewBox="`0 0 ${size} ${size}`" :style="{ filter: shadow }" aria-hidden="true">
        <defs>
          <clipPath :id="`${id}-clip`"><path :d="shape" /></clipPath>
          <linearGradient :id="`${id}-fill`" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" class="fill-0" />
            <stop offset="0.5" class="fill-1" />
            <stop offset="1" class="fill-2" />
          </linearGradient>
          <linearGradient :id="`${id}-sheen`" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity="0.09" />
            <stop offset="0.38" stop-color="#fff" stop-opacity="0.025" />
            <stop offset="0.52" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <!-- The glass rim: bright where the light hits, faint on the far edge. -->
          <linearGradient :id="`${id}-rim`" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" class="rim-0" />
            <stop offset="0.5" class="rim-1" />
            <stop offset="1" class="rim-2" />
          </linearGradient>
          <linearGradient :id="`${id}-sweep`" x1="0" y1="0.25" x2="1" y2="0.75">
            <stop offset="0.38" stop-color="#fff" stop-opacity="0" />
            <stop offset="0.5" stop-color="#fff" stop-opacity="0.1" />
            <stop offset="0.62" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
        </defs>

        <g :clip-path="`url(#${id}-clip)`">
          <path :d="shape" :fill="small ? undefined : `url(#${id}-fill)`" class="base" />
          <template v-if="!small">
            <path :d="shape" :fill="`url(#${id}-sheen)`" />
            <!-- A 2px stroke clipped to the shape leaves a 1px inner rim. -->
            <path :d="shape" fill="none" :stroke="`url(#${id}-rim)`" stroke-width="2" />
            <rect
              v-if="hero"
              class="sweep"
              :width="size"
              :height="size"
              :fill="`url(#${id}-sweep)`"
            />
          </template>
          <path v-else :d="shape" fill="none" class="ring" stroke-width="2" />
        </g>

        <svg :width="size" :height="size" viewBox="0 0 36 36">
          <path
            fill="#fff"
            d="M22.5 10.93h3.86c1.06 0 1.93.86 1.93 1.93v11.57c0 1.06-.87 1.93-1.93 1.93H9.64c-1.06 0-1.93-.87-1.93-1.93v-7.59h2.57v6.94h15.43V13.5H7.71v-2.57h5.79V9h9v1.93Zm-1.29 8.49h-6.43v-2.57h6.43v2.57Z"
          />
        </svg>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.mark {
  --mark-shadow: rgb(0 0 0 / 0.2);
  position: relative;
  width: var(--size);
  height: var(--size);
  flex-shrink: 0;
}

.tile,
.tile svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.fill-0 {
  stop-color: #2b2b2b;
}
.fill-1 {
  stop-color: #161616;
}
.fill-2 {
  stop-color: #0e0e0e;
}
.rim-0 {
  stop-color: #fff;
  stop-opacity: 0.09;
}
.rim-1 {
  stop-color: #fff;
  stop-opacity: 0.02;
}
.rim-2 {
  stop-color: #fff;
  stop-opacity: 0.035;
}
.small .base {
  fill: #161616;
}
.ring {
  stroke: transparent;
}

.halo {
  position: absolute;
  inset: -70%;
  border-radius: 9999px;
  background: radial-gradient(closest-side, rgb(0 0 0 / 0.05), transparent);
  pointer-events: none;
}

.sweep {
  transform: translateX(calc(var(--size) * -1.3));
}
.hero .tile {
  animation: rise 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.hero .sweep {
  animation: sweep 1.4s cubic-bezier(0.16, 1, 0.3, 1) 0.55s both;
}
.hero .halo {
  animation: fade 1.2s ease 0.2s both;
}

[data-theme='dark'] .mark {
  --mark-shadow: rgb(0 0 0 / 0.45);
}
[data-theme='dark'] .fill-0 {
  stop-color: #383838;
}
[data-theme='dark'] .fill-1 {
  stop-color: #1e1e1e;
}
[data-theme='dark'] .fill-2 {
  stop-color: #161616;
}
[data-theme='dark'] .rim-0 {
  stop-opacity: 0.11;
}
[data-theme='dark'] .rim-1 {
  stop-opacity: 0.04;
}
[data-theme='dark'] .rim-2 {
  stop-opacity: 0.05;
}
[data-theme='dark'] .small .base {
  fill: #262626;
}
[data-theme='dark'] .ring {
  stroke: rgb(255 255 255 / 0.08);
}
[data-theme='dark'] .halo {
  background: radial-gradient(closest-side, rgb(255 255 255 / 0.05), transparent);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.88);
    filter: blur(6px);
  }
}
@keyframes sweep {
  from {
    transform: translateX(calc(var(--size) * -1.3));
  }
  to {
    transform: translateX(calc(var(--size) * 1.3));
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero .tile,
  .hero .sweep,
  .hero .halo {
    animation: none;
  }
}
</style>
