<script setup lang="ts">
import { Button, Popover, TextInput } from 'frappe-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

type Family = { name: string; base: string; shades: string[] }
type ColorTarget = 'border' | 'fill'
type PickerMode = 'sidebar' | 'property-object' | 'property-solid'
type PropertyKind = 'shape' | 'text' | 'draw' | 'arrow' | 'line'
type StrokeStyle = 'solid' | 'dashed' | 'dotted'
type StylePatch = { strokeWidth?: number; strokeStyle?: StrokeStyle }

const props = defineProps<{
  color?: string | null
  secondaryColor?: string | null
  strokeWidth?: number
  strokeStyle?: StrokeStyle
  showBorderOptions?: boolean
  showStrokeStyleOptions?: boolean
  open?: boolean
  label: string
  target: ColorTarget
  mode?: PickerMode
  propertyKind?: PropertyKind
}>()
const emit = defineEmits<{
  select: [color: string | undefined, target?: ColorTarget]
  style: [patch: StylePatch]
  'update:open': [open: boolean]
}>()

const families: Family[] = [
  {
    name: 'Gray',
    base: '#383838',
    shades: ['#f3f3f3', '#e2e2e2', '#999999', '#525252', '#171717'],
  },
  {
    name: 'Blue',
    base: '#0289f7',
    shades: ['#e6f4ff', '#a7d7fd', '#0289f7', '#0070cc', '#004880'],
  },
  {
    name: 'Green',
    base: '#30a66d',
    shades: ['#e4faeb', '#b9eecc', '#59ba8b', '#278f5e', '#173b2c'],
  },
  { name: 'Red', base: '#e03636', shades: ['#ffe7e7', '#fdc2c2', '#e03636', '#b52a2a', '#6b1515'] },
  {
    name: 'Orange',
    base: '#e86c13',
    shades: ['#ffefe4', '#ffcba3', '#e86c13', '#bd3e0c', '#6b2711'],
  },
  {
    name: 'Yellow',
    base: '#edba13',
    shades: ['#fff7d3', '#f5e171', '#edba13', '#ab6e05', '#733f12'],
  },
  {
    name: 'Purple',
    base: '#9c45e3',
    shades: ['#f6e9ff', '#e2b9fc', '#9c45e3', '#6e399d', '#401863'],
  },
  {
    name: 'Pink',
    base: '#e34aa6',
    shades: ['#fde8f5', '#f9b9e0', '#e34aa6', '#9c2671', '#570f3e'],
  },
  {
    name: 'Teal',
    base: '#36baad',
    shades: ['#e6f7f4', '#97ded4', '#36baad', '#0f736b', '#114541'],
  },
  {
    name: 'Cyan',
    base: '#3bbde5',
    shades: ['#ddf7ff', '#99e2f8', '#3bbde5', '#267a94', '#164759'],
  },
  {
    name: 'Amber',
    base: '#e79913',
    shades: ['#fdf8ed', '#fbdb73', '#e79913', '#b35309', '#763813'],
  },
  {
    name: 'Violet',
    base: '#6846e3',
    shades: ['#f0ebff', '#c9bafb', '#6846e3', '#4f3da1', '#251959'],
  },
  {
    name: 'Lime',
    base: '#8db20c',
    shades: ['#f3fadf', '#dfeeb2', '#a9cf4d', '#6f8b0a', '#374505'],
  },
  {
    name: 'Brown',
    base: '#9a624a',
    shades: ['#f7eee9', '#e8c8b8', '#b97c62', '#744532', '#3d2117'],
  },
  {
    name: 'Rose',
    base: '#e6577a',
    shades: ['#ffeaef', '#ffc4d2', '#e6577a', '#b73455', '#651526'],
  },
]
const propertyFamilies = [
  'Gray',
  'Red',
  'Orange',
  'Amber',
  'Yellow',
  'Green',
  'Teal',
  'Cyan',
  'Blue',
  'Purple',
  'Pink',
].map((name) => families.find((option) => option.name === name)!)

const colorKeys = ['q', 'w', 's', 'g', 'h', 'j', 'u', 'y', 'b', 'v', 'n', 'm']

const pickerPanel = ref<HTMLElement | null>(null)

async function focusPicker() {
  await nextTick()
  pickerPanel.value?.focus({ preventScroll: true })
}

const recent = ref(['#383838', '#0289f7', '#30a66d', '#e86c13', '#9c45e3'])
const family = ref(families[6]!)
const hex = ref(props.color ?? '')
const selectionTarget = ref<ColorTarget>(props.target)
const shades = computed(() => family.value.shades)
const palette = computed(() =>
  families.map((family) => ({ family, color: family.shades[props.target === 'fill' ? 1 : 3] })),
)
const propertyPalette = computed(() =>
  propertyFamilies.map((family) => ({
    family,
    color: family.shades[props.target === 'fill' ? 1 : 3],
  })),
)
const propertyFillPalette = computed(() =>
  propertyFamilies.map((family) => ({ family, color: family.shades[0] })),
)
const propertyBorderPalette = computed(() =>
  propertyFamilies.map((family) => ({ family, color: family.base })),
)
const shadeLabel = computed(
  () => `${family.value.name} ${selectionTarget.value === 'fill' ? 'Fill' : 'Border'} Shades`,
)
const hexLabel = computed(() => `${selectionTarget.value === 'fill' ? 'Fill' : 'Border'} Hex Code`)
const isProperty = computed(() => props.mode !== undefined && props.mode !== 'sidebar')
const isPropertyObject = computed(() => props.mode === 'property-object')
const showBorderOptions = computed(() => Boolean(props.showBorderOptions))
const propertyKind = computed(
  () => props.propertyKind ?? (showBorderOptions.value ? 'shape' : 'text'),
)
const showStrokeStyleOptions = computed(
  () => propertyKind.value !== 'text' && (props.showStrokeStyleOptions ?? showBorderOptions.value),
)
const primaryLabel = computed(
  () =>
    ({
      shape: 'Fill Color',
      text: 'Background Color',
      draw: 'Background Color',
      arrow: 'Arrow Head Color',
      line: 'Light Colors',
    })[propertyKind.value],
)
const secondaryLabel = computed(
  () =>
    ({
      shape: 'Border Color',
      text: 'Text Color',
      draw: 'Pen Color',
      arrow: 'Body Color',
      line: 'Dark Colors',
    })[propertyKind.value],
)
const primaryTarget = computed<ColorTarget>(() =>
  propertyKind.value === 'text' ? 'border' : 'fill',
)
const secondaryTarget = computed<ColorTarget>(() =>
  propertyKind.value === 'text' ? 'fill' : 'border',
)
const primaryPalette = computed(() =>
  propertyKind.value === 'arrow' ? propertyBorderPalette.value : propertyFillPalette.value,
)
const borderWidths = [
  { label: __('Thin'), value: 1.5 },
  { label: __('Medium'), value: 3 },
  { label: __('Thick'), value: 5 },
]
const borderStyles = [
  { label: __('Solid'), value: 'solid' },
  { label: __('Dashed'), value: 'dashed' },
  { label: __('Dotted'), value: 'dotted' },
] as const

watch(
  () => props.target,
  (target) => {
    selectionTarget.value = target
    selectExistingFamily(appliedColor(target))
  },
  { immediate: true },
)

watch(
  () => [props.color, props.secondaryColor],
  () => {
    selectExistingFamily(appliedColor(selectionTarget.value))
  },
)

function appliedColor(target: ColorTarget) {
  return target === 'fill'
    ? props.color
    : isPropertyObject.value
      ? props.secondaryColor
      : (props.secondaryColor ?? props.color)
}

function isSelectedColor(color: string | undefined, target = selectionTarget.value) {
  const applied = appliedColor(target)
  if (color === undefined) return !applied || applied === 'none' || applied === 'transparent'
  return applied?.toLowerCase() === color.toLowerCase()
}

function selectExistingFamily(color: string | null | undefined) {
  hex.value = color ?? ''
  family.value =
    families.find(
      (option) =>
        option.base === color ||
        option.shades.some((shade) => shade.toLowerCase() === color?.toLowerCase()),
    ) ?? family.value
}

function selectColor(
  color: string | undefined,
  nextFamily = families.find((option) => option.base === color),
  target = selectionTarget.value,
) {
  selectionTarget.value = target
  if (color === undefined) {
    emit('select', undefined, target)
    return
  }
  if (nextFamily) family.value = nextFamily
  hex.value = color
  recent.value = [color, ...recent.value.filter((value) => value !== color)].slice(0, 5)
  emit('select', color, target)
}

function onColorShortcut(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  const shadeIndex =
    event.shiftKey && /^Digit[1-5]$/.test(event.code) ? Number(event.code.slice(-1)) - 1 : -1
  const colorIndex = isPropertyObject.value ? colorKeys.indexOf(event.key.toLowerCase()) : -1
  if (shadeIndex < 0 && colorIndex < 0) return
  event.preventDefault()
  event.stopPropagation()
  if (shadeIndex >= 0) {
    selectColor(shades.value[shadeIndex])
    return
  }
  const colorTarget = event.shiftKey ? secondaryTarget.value : primaryTarget.value
  const option = (event.shiftKey ? propertyBorderPalette.value : primaryPalette.value)[
    colorIndex - 1
  ]
  selectColor(option?.color, option?.family, colorTarget)
}

function shortcutTextColor(color: string) {
  const value = Number.parseInt(color.slice(1), 16)
  const brightness = ((value >> 16) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) / 1000
  return brightness > 150 && color.toLowerCase() !== '#999999' ? '#999999' : '#e2e2e2'
}

function updateHex(value: string) {
  hex.value = value
  if (/^#[0-9a-f]{6}$/i.test(value)) selectColor(value)
}

async function pickScreenColor() {
  const Picker = (
    window as typeof window & {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> }
    }
  ).EyeDropper
  if (!Picker) return
  try {
    selectColor((await new Picker().open()).sRGBHex)
  } catch {}
}
</script>

<template>
  <span :class="['color-trigger-anchor', { 'property-color-control': isProperty }]">
    <Popover
      :auto-focus="false"
      :open="isProperty ? open : undefined"
      :side="isProperty ? 'top' : 'left'"
      :align="isProperty ? 'center' : 'start'"
      :offset="isProperty ? 11 : 20"
      :collision-padding="16"
      arrow
      @open="focusPicker"
      @update:open="emit('update:open', $event)"
    >
      <template #trigger>
        <Button
          :class="['color-trigger', { 'color-trigger--property': isProperty }]"
          size="xs"
          variant="ghost"
          theme="gray"
          :style="{ '--color': color }"
          :label="label"
          :tooltip="isProperty ? 'Custom' : label"
        />
      </template>
      <div
        ref="pickerPanel"
        tabindex="-1"
        :class="[
          'color-picker',
          {
            'color-picker--property': isProperty,
            'color-picker--property-object': isPropertyObject,
          },
        ]"
        @keydown="onColorShortcut"
      >
        <section v-if="!isProperty">
          <h3>{{ __('Most used custom colors') }}</h3>
          <div class="color-row">
            <button
              v-for="color in recent"
              :key="color"
              :style="{ background: color }"
              :aria-label="color"
              @click="selectColor(color)"
            />
          </div>
        </section>
        <template v-if="isPropertyObject">
          <section>
            <h3>{{ primaryLabel }}</h3>
            <div class="color-grid">
              <button
                :class="['none-color', { selected: isSelectedColor(undefined, primaryTarget) }]"
                :aria-pressed="isSelectedColor(undefined, primaryTarget)"
                :aria-label="`No ${primaryLabel.toLowerCase()} (Q)`"
                aria-keyshortcuts="q"
                :title="__('Q')"
                @click="selectColor(undefined, undefined, primaryTarget)"
              >
                {{ __('None') }}<span class="color-shortcut" aria-hidden="true">{{ __('q') }}</span>
              </button>
              <button
                v-for="(option, index) in primaryPalette"
                :key="option.family.name"
                :class="{ selected: isSelectedColor(option.color, primaryTarget) }"
                :style="{ background: option.color, color: shortcutTextColor(option.color) }"
                :aria-label="`${option.family.name} ${primaryLabel.toLowerCase()} (${colorKeys[index + 1]})`"
                :aria-keyshortcuts="colorKeys[index + 1]"
                :title="colorKeys[index + 1]"
                @click="selectColor(option.color, option.family, primaryTarget)"
              >
                <span class="color-shortcut" aria-hidden="true">{{ colorKeys[index + 1] }}</span>
              </button>
            </div>
          </section>
          <section>
            <h3>{{ secondaryLabel }}</h3>
            <div class="color-grid">
              <button
                :class="['none-color', { selected: isSelectedColor(undefined, secondaryTarget) }]"
                :aria-pressed="isSelectedColor(undefined, secondaryTarget)"
                :aria-label="`No ${secondaryLabel.toLowerCase()} (Shift+Q)`"
                aria-keyshortcuts="Shift+q"
                :title="__('Shift+Q')"
                @click="selectColor(undefined, undefined, secondaryTarget)"
              >
                {{ __('None')
                }}<span class="color-shortcut" aria-hidden="true">{{ __('⇧q') }}</span>
              </button>
              <button
                v-for="(option, index) in propertyBorderPalette"
                :key="option.family.name"
                :class="{ selected: isSelectedColor(option.color, secondaryTarget) }"
                :style="{ background: option.color, color: shortcutTextColor(option.color) }"
                :aria-label="`${option.family.name} ${secondaryLabel.toLowerCase()} (Shift+${colorKeys[index + 1]})`"
                :aria-keyshortcuts="`Shift+${colorKeys[index + 1]}`"
                :title="`Shift+${colorKeys[index + 1]}`"
                @click="selectColor(option.color, option.family, secondaryTarget)"
              >
                <span class="color-shortcut" aria-hidden="true"
                  >{{ __('⇧') }}{{ colorKeys[index + 1] }}</span
                >
              </button>
            </div>
          </section>
        </template>
        <section v-else>
          <h3>{{ __('Colors') }}</h3>
          <div class="color-grid">
            <button
              class="none-color"
              :aria-label="`No ${selectionTarget} color`"
              @click="selectColor(undefined)"
            >
              {{ __('None') }}
            </button>
            <button
              v-for="option in isProperty ? propertyPalette : palette"
              :key="option.family.name"
              :class="{ selected: isSelectedColor(option.color) }"
              :style="{ background: option.color, color: shortcutTextColor(option.color) }"
              :aria-label="option.family.name"
              @click="selectColor(option.color, option.family)"
            />
          </div>
        </section>
        <section>
          <h3>{{ shadeLabel }}</h3>
          <div class="color-row">
            <button
              v-for="(color, index) in shades"
              :key="color"
              :class="{ selected: isSelectedColor(color) }"
              :style="{ background: color, color: shortcutTextColor(color) }"
              :aria-label="`${color} (Shift+${index + 1})`"
              :aria-keyshortcuts="`Shift+${index + 1}`"
              :title="`Shift+${index + 1}`"
              @click="selectColor(color)"
            >
              <span class="color-shortcut" aria-hidden="true">{{ __('⇧') }}{{ index + 1 }}</span>
            </button>
          </div>
        </section>
        <section class="hex-section">
          <h3>{{ hexLabel }}</h3>
          <TextInput
            class="hex-field"
            :model-value="hex.slice(1)"
            size="sm"
            variant="outline"
            :aria-label="hexLabel"
            maxlength="6"
            @update:model-value="updateHex(`#${$event.replace(/^#/, '')}`)"
          >
            <template #prefix
              ><span class="hex-prefix">{{ __('#') }}</span></template
            >
            <template #suffix>
              <Button
                size="xs"
                variant="ghost"
                theme="gray"
                icon="lucide-pipette"
                :label="__('Color Picker')"
                :tooltip="__('Color Picker')"
                @click="pickScreenColor"
              />
            </template>
          </TextInput>
        </section>
        <section v-if="showBorderOptions">
          <h3>{{ __('Border thickness') }}</h3>
          <div class="border-options">
            <button
              v-for="option in borderWidths"
              :key="option.label"
              :class="['stroke-option', { selected: props.strokeWidth === option.value }]"
              :aria-label="option.label"
              @click="emit('style', { strokeWidth: option.value })"
            >
              <svg viewBox="0 0 28 12" aria-hidden="true">
                <path d="M2 6h24" :stroke-width="option.value" />
              </svg>
            </button>
          </div>
        </section>
        <section v-if="showStrokeStyleOptions">
          <h3>{{ __('Border style') }}</h3>
          <div class="border-options">
            <button
              v-for="option in borderStyles"
              :key="option.value"
              :class="['stroke-option', { selected: props.strokeStyle === option.value }]"
              :aria-label="option.label"
              @click="emit('style', { strokeStyle: option.value })"
            >
              <svg viewBox="0 0 28 12" aria-hidden="true">
                <path d="M2 6h24" :class="option.value" />
              </svg>
            </button>
          </div>
        </section>
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.color-trigger-anchor {
  display: contents;
}
.color-trigger-anchor :deep(.color-trigger) {
  width: 26px !important;
  height: 26px !important;
  padding: 0;
  border-radius: 5px !important;
  background: var(--color) !important;
}
.color-trigger-anchor :deep(.color-trigger--property) {
  width: 28px !important;
  height: 28px !important;
  padding: 0 6px;
  border-radius: 6px !important;
  background: conic-gradient(
    from 45deg,
    #ef4444,
    #f59e0b,
    #10b981,
    #3b82f6,
    #a855f7,
    #ef4444
  ) !important;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%);
}
.color-trigger-anchor :deep(.color-trigger .truncate) {
  display: none;
}
.color-picker {
  outline: none;
  width: 264px;
  padding: 18px;
  color: var(--ink-gray-7);
}
.color-picker--property {
  width: 198px;
  padding: 14px;
}
.color-picker--property-object {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 386px;
  max-width: var(--reka-popover-content-available-width, calc(100vw - 32px));
}
.color-picker section + section {
  margin-top: 16px;
}
.color-picker--property section + section {
  margin-top: 12px;
}
.color-picker--property-object section + section {
  margin-top: 0;
}
h3 {
  margin: 0 0 8px;
  color: var(--ink-gray-7);
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
}
.color-picker--property h3 {
  margin-bottom: 6px;
}
.color-row,
.color-grid {
  display: grid;
  grid-template-columns: repeat(5, 34px);
  gap: 6px;
}
.color-picker--property .color-row,
.color-picker--property .color-grid {
  grid-template-columns: repeat(5, 30px);
  gap: 5px;
}
.color-picker--property-object .color-row {
  grid-template-columns: repeat(5, 26px);
  gap: 4px;
}
.color-picker--property-object .color-grid {
  grid-template-columns: repeat(6, 26px);
  gap: 4px;
}
.color-row button,
.color-grid button {
  position: relative;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.color-shortcut {
  position: absolute;
  right: 3px;
  bottom: 2px;
  font-size: 10px;
  font-weight: 500;
  line-height: 12px;
  pointer-events: none;
}
.color-picker--property .color-row button,
.color-picker--property .color-grid button {
  width: 30px;
  height: 30px;
}
.color-picker--property-object .color-row button,
.color-picker--property-object .color-grid button {
  width: 26px;
  height: 26px;
}
.none-color {
  border: 1px solid var(--outline-gray-2) !important;
  background:
    linear-gradient(45deg, rgb(82 82 82 / 42%) 25%, transparent 25%) 0 0 / 8px 8px,
    linear-gradient(-45deg, rgb(82 82 82 / 42%) 25%, transparent 25%) 0 4px / 8px 8px,
    linear-gradient(45deg, transparent 75%, rgb(82 82 82 / 42%) 75%) 4px -4px / 8px 8px,
    linear-gradient(-45deg, transparent 75%, rgb(82 82 82 / 42%) 75%) -4px 0 / 8px 8px,
    var(--surface-base) !important;
  color: transparent;
  font-size: 0;
}
.none-color .color-shortcut {
  color: #999999;
  background: var(--surface-base);
  border-radius: 2px;
}
.none-color:hover {
  color: var(--ink-gray-9);
}
.color-row button:hover,
.color-grid button:hover,
.color-row button.selected,
.color-grid button.selected {
  outline: 1px solid var(--outline-gray-4);
  outline-offset: 1px;
}
.color-row button:focus-visible,
.color-grid button:focus-visible {
  outline: 2px solid var(--outline-gray-4);
  outline-offset: 2px;
}
.color-picker :deep(.hex-field) {
  margin-top: 0;
}
.color-picker--property-object .hex-section {
  align-self: end;
}
.color-picker--property-object :deep(.hex-field) {
  width: 100%;
}
.border-options {
  display: flex;
  gap: 5px;
}
.stroke-option {
  display: flex;
  width: 30px;
  height: 26px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: var(--surface-gray-2);
  color: var(--ink-gray-7);
  cursor: pointer;
}
.stroke-option.selected,
.stroke-option:hover {
  border-color: var(--outline-gray-4);
}
.stroke-option:focus-visible {
  outline: 2px solid var(--outline-gray-4);
  outline-offset: 2px;
}
.stroke-option svg {
  width: 24px;
  height: 12px;
}
.stroke-option path {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
}
.stroke-option path.dashed {
  stroke-dasharray: 5 3;
}
.stroke-option path.dotted {
  stroke-dasharray: 1 3;
  stroke-linecap: round;
  stroke-width: 2;
}
.color-picker :deep(.hex-field input) {
  font-weight: 400;
  line-height: 20px;
}
.color-picker :deep(.hex-prefix) {
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
}
@media (max-width: 417px) {
  .color-picker--property-object {
    grid-template-columns: 1fr;
  }
}
</style>
