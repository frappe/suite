<!--
  Frappe-styled colour picker, modelled on Gameplan's ColorPicker: a Popover
  with a grid of round Tailwind-palette chips (one family per row, light→dark).
  frappe-ui ships no reusable colour picker, so this replaces the bare
  <input type="color"> (the OS dialog) everywhere in the editor.

  Beyond Gameplan's grid we keep a Default/None reset and a hex + Custom row,
  which a spreadsheet needs (clear text colour, no fill, arbitrary hex).

  v-model is the colour as a literal #rrggbb, or '' for the default/unset state.
  The trigger is a small swatch by default; pass a #trigger slot to supply your
  own (the toolbar uses its glyph + underline button).
-->
<template>
  <Popover :placement="placement">
    <template #target="{ togglePopover, isOpen }">
      <slot name="trigger" :toggle="togglePopover" :open="isOpen" :color="modelValue">
        <button type="button" class="sn-cp-trigger" :class="{ open: isOpen }" :title="title" @click="togglePopover()">
          <span class="sn-cp-trigger-sw" :style="{ background: isHex(modelValue) ? modelValue : 'transparent' }" />
        </button>
      </slot>
    </template>
    <template #body="{ close }">
      <div class="sn-cp-pop">
        <div class="sn-cp-grid">
          <button v-for="c in COLORS" :key="c" type="button" class="sn-cp-sw"
                  :class="{ sel: eqHex(c, modelValue) }" :style="{ background: c }" :title="c"
                  @click="choose(c, close)">
            <FeatherIcon v-if="eqHex(c, modelValue)" name="check" class="sn-cp-check" :style="{ color: contrast(c) }" />
          </button>
        </div>
        <div class="sn-cp-foot">
          <button v-if="allowDefault" type="button" class="sn-cp-iconbtn" :class="{ sel: !isHex(modelValue) }"
                  :title="defaultLabel" @click="choose(defaultValue, close)">
            <FeatherIcon name="slash" class="sn-cp-icon" />
          </button>
          <span class="sn-cp-hash">#</span>
          <input class="sn-cp-hex" :value="hexBody" maxlength="6" placeholder="rrggbb" spellcheck="false"
                 @input="hexBody = norm($event.target.value)"
                 @keydown.enter.prevent="commitHex(close)" @blur="commitHex(null)" />
          <label class="sn-cp-iconbtn" :title="`Custom colour`">
            <FeatherIcon name="plus" class="sn-cp-icon" />
            <input type="color" :value="nativeValue()" @input="choose($event.target.value, null)" />
          </label>
        </div>
      </div>
    </template>
  </Popover>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Popover, FeatherIcon } from 'frappe-ui'

// Tailwind palette, one family per row (50→900), flattened in row order so the
// grid reads as 9 columns × 8 families — same source palette Gameplan uses.
const PALETTE = {
  gray:   ['#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827'],
  red:    ['#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'],
  orange: ['#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12'],
  yellow: ['#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12'],
  green:  ['#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d'],
  teal:   ['#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a'],
  blue:   ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'],
  purple: ['#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87'],
  pink:   ['#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843'],
}
const COLORS = Object.values(PALETTE).flat()

const props = defineProps({
  modelValue:   { type: String, default: '' },
  allowDefault: { type: Boolean, default: false },
  defaultValue: { type: String, default: '' },
  defaultLabel: { type: String, default: 'Default' },
  title:        { type: String, default: 'Colour' },
  placement:    { type: String, default: 'bottom-start' },
  // The native picker needs a literal hex even when modelValue is unset.
  fallback:     { type: String, default: '#000000' },
})
const emit = defineEmits(['update:modelValue'])

const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
const eqHex = (a, b) => isHex(a) && isHex(b) && a.toLowerCase() === b.toLowerCase()
const norm  = s => s.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)

const nativeValue = () => isHex(props.modelValue) ? props.modelValue : (isHex(props.fallback) ? props.fallback : '#000000')

// Editable hex field, kept in sync with the model.
const hexBody = ref(isHex(props.modelValue) ? props.modelValue.slice(1) : '')
watch(() => props.modelValue, v => { hexBody.value = isHex(v) ? v.slice(1) : '' })

function choose(v, close) {
  emit('update:modelValue', v)
  if (close) close()
}

function commitHex(close) {
  const h = hexBody.value
  if (h.length !== 3 && h.length !== 6) return
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  choose('#' + full.toLowerCase(), close)
}

// Readable ink for a chip background (dark on light, white on dark).
function contrast(hex) {
  if (!isHex(hex)) return '#1F2937'
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1F2937' : '#FFFFFF'
}
</script>

<style scoped>
.sn-cp-trigger { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:6px; border:1px solid var(--outline-gray-2); background:var(--surface-base); cursor:pointer; padding:0; }
.sn-cp-trigger:hover, .sn-cp-trigger.open { background:var(--surface-gray-2); }
.sn-cp-trigger-sw { width:16px; height:16px; border-radius:4px; border:1px solid var(--outline-gray-2); }

/* Width pinned to the grid (9×20px chips + 8×6px gaps + 12px padding each side)
   so the footer's hex input can't widen the popover past the swatches. */
.sn-cp-pop { padding:12px; width:252px; background:var(--surface-elevation-2, #fff); border:1px solid var(--outline-elevation-2, var(--outline-gray-2)); border-radius:10px; box-shadow:0 6px 24px rgba(0,0,0,.14); }

.sn-cp-grid { display:grid; grid-template-columns:repeat(9, 20px); gap:6px; justify-content:space-between; }
.sn-cp-sw { width:20px; height:20px; border-radius:9999px; border:1px solid rgba(0,0,0,.10); cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center; transition:transform .1s; }
.sn-cp-sw:hover { transform:scale(1.18); }
.sn-cp-sw.sel { box-shadow:0 0 0 2px var(--surface-base), 0 0 0 3.5px var(--outline-gray-5); }
.sn-cp-check { width:11px; height:11px; }

.sn-cp-foot { display:flex; align-items:center; gap:6px; margin-top:12px; }
.sn-cp-hash { font-size:13px; color:var(--ink-gray-5); margin-left:2px; }
.sn-cp-hex { flex:1; min-width:0; height:30px; padding:0 10px; font-size:13px; text-transform:uppercase; border:1px solid var(--outline-gray-2); border-radius:8px; color:var(--ink-gray-9); background:var(--surface-base); outline:none; }
.sn-cp-hex:focus { border-color:var(--outline-gray-4); }
.sn-cp-iconbtn { position:relative; display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:8px; border:1px solid var(--outline-gray-2); cursor:pointer; color:var(--ink-gray-7); background:var(--surface-base); flex-shrink:0; }
.sn-cp-iconbtn:hover { background:var(--surface-gray-2); }
.sn-cp-iconbtn.sel { border-color:var(--outline-gray-4); color:var(--ink-gray-9); }
.sn-cp-icon { width:15px; height:15px; pointer-events:none; }
.sn-cp-iconbtn input[type=color] { position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer; }
</style>
