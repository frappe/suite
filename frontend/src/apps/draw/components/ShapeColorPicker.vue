<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from 'frappe-ui'
import { Popover } from 'frappe-ui'
import { TextInput } from 'frappe-ui'

type Family = { name: string; base: string; shades: string[] }
type ColorTarget = 'border' | 'fill'
type PickerMode = 'sidebar' | 'property-object' | 'property-solid'
type PropertyKind = 'shape' | 'text' | 'draw' | 'arrow' | 'line'
type StrokeStyle = 'solid' | 'dashed' | 'dotted'
type StylePatch = { strokeWidth?: number; strokeStyle?: StrokeStyle }

const props = defineProps<{
  color: string
  secondaryColor?: string
  strokeWidth?: number
  strokeStyle?: StrokeStyle
  showBorderOptions?: boolean
  label: string
  target: ColorTarget
  mode?: PickerMode
  propertyKind?: PropertyKind
}>()
const emit = defineEmits<{ select: [color: string | undefined, target?: ColorTarget]; style: [patch: StylePatch] }>()

const families: Family[] = [
  { name: 'Gray', base: '#383838', shades: ['#f3f3f3', '#e2e2e2', '#999999', '#525252', '#171717'] },
  { name: 'Blue', base: '#0289f7', shades: ['#e6f4ff', '#a7d7fd', '#0289f7', '#0070cc', '#004880'] },
  { name: 'Green', base: '#30a66d', shades: ['#e4faeb', '#b9eecc', '#59ba8b', '#278f5e', '#173b2c'] },
  { name: 'Red', base: '#e03636', shades: ['#ffe7e7', '#fdc2c2', '#e03636', '#b52a2a', '#6b1515'] },
  { name: 'Orange', base: '#e86c13', shades: ['#ffefe4', '#ffcba3', '#e86c13', '#bd3e0c', '#6b2711'] },
  { name: 'Yellow', base: '#edba13', shades: ['#fff7d3', '#f5e171', '#edba13', '#ab6e05', '#733f12'] },
  { name: 'Purple', base: '#9c45e3', shades: ['#f6e9ff', '#e2b9fc', '#9c45e3', '#6e399d', '#401863'] },
  { name: 'Pink', base: '#e34aa6', shades: ['#fde8f5', '#f9b9e0', '#e34aa6', '#9c2671', '#570f3e'] },
  { name: 'Teal', base: '#36baad', shades: ['#e6f7f4', '#97ded4', '#36baad', '#0f736b', '#114541'] },
  { name: 'Cyan', base: '#3bbde5', shades: ['#ddf7ff', '#99e2f8', '#3bbde5', '#267a94', '#164759'] },
  { name: 'Amber', base: '#e79913', shades: ['#fff7d3', '#fbdb73', '#e79913', '#b35309', '#763813'] },
  { name: 'Violet', base: '#6846e3', shades: ['#f0ebff', '#c9bafb', '#6846e3', '#4f3da1', '#251959'] },
  { name: 'Lime', base: '#8db20c', shades: ['#f3fadf', '#dfeeb2', '#a9cf4d', '#6f8b0a', '#374505'] },
  { name: 'Brown', base: '#9a624a', shades: ['#f7eee9', '#e8c8b8', '#b97c62', '#744532', '#3d2117'] },
  { name: 'Rose', base: '#e6577a', shades: ['#ffeaef', '#ffc4d2', '#e6577a', '#b73455', '#651526'] },
]

const recent = ref(['#383838', '#0289f7', '#30a66d', '#e86c13', '#9c45e3'])
const family = ref(families[6]!)
const hex = ref(props.color)
const selectionTarget = ref<ColorTarget>(props.target)
const shades = computed(() => family.value.shades)
const palette = computed(() => families.map(family => ({ family, color: family.shades[props.target === 'fill' ? 1 : 3] })))
const propertyPalette = computed(() => families.slice(0, 10).map(family => ({ family, color: family.shades[props.target === 'fill' ? 1 : 3] })))
const propertyFillPalette = computed(() => families.slice(0, 11).map(family => ({ family, color: family.shades[0] })))
const propertyBorderPalette = computed(() => families.slice(0, 11).map(family => ({ family, color: family.base })))
const shadeLabel = computed(() => `${family.value.name} shades`)
const isProperty = computed(() => props.mode !== undefined && props.mode !== 'sidebar')
const isPropertyObject = computed(() => props.mode === 'property-object')
const showBorderOptions = computed(() => Boolean(props.showBorderOptions))
const propertyKind = computed(() => props.propertyKind ?? (showBorderOptions.value ? 'shape' : 'text'))
const primaryLabel = computed(() => ({ shape: 'Fill Color', text: 'Background Color', draw: 'Background Color', arrow: 'Arrow Head Color', line: 'Light Colors' })[propertyKind.value])
const secondaryLabel = computed(() => ({ shape: 'Border Color', text: 'Text Color', draw: 'Pen Color', arrow: 'Body Color', line: 'Dark Colors' })[propertyKind.value])
const primaryTarget = computed<ColorTarget>(() => propertyKind.value === 'text' ? 'border' : 'fill')
const secondaryTarget = computed<ColorTarget>(() => propertyKind.value === 'text' ? 'fill' : 'border')
const primaryPalette = computed(() => propertyKind.value === 'arrow' ? propertyBorderPalette.value : propertyFillPalette.value)
const borderWidths = [
  { label: 'Thin', value: 1.5 },
  { label: 'Medium', value: 3 },
  { label: 'Thick', value: 5 },
]
const borderStyles = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
] as const

watch(() => props.target, target => {
  selectionTarget.value = target
  selectExistingFamily(target === 'border' ? props.secondaryColor ?? props.color : props.color)
}, { immediate: true })

watch(() => [props.color, props.secondaryColor], () => {
  const color = selectionTarget.value === 'border' ? props.secondaryColor ?? props.color : props.color
  selectExistingFamily(color)
})

function selectExistingFamily(color: string) {
  hex.value = color
  family.value = families.find(option => option.base === color || option.shades.includes(color)) ?? family.value
}

function selectColor(color: string | undefined, nextFamily = families.find(option => option.base === color), target = selectionTarget.value) {
  selectionTarget.value = target
  if (color === undefined) {
    emit('select', undefined, target)
    return
  }
  if (nextFamily) family.value = nextFamily
  hex.value = color
  recent.value = [color, ...recent.value.filter(value => value !== color)].slice(0, 5)
  emit('select', color, target)
}

function updateHex(value: string) {
  hex.value = value
  if (/^#[0-9a-f]{6}$/i.test(value)) selectColor(value)
}

async function pickScreenColor() {
  const Picker = (window as typeof window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
  if (!Picker) return
  try { selectColor((await new Picker().open()).sRGBHex) } catch { /* picker cancelled */ }
}
</script>

<template>
  <span class="color-trigger-anchor">
    <Popover :side="isProperty ? 'top' : 'left'" align="start" :offset="isProperty ? 11 : 20" :collision-padding="16" arrow>
      <template #trigger>
        <Button :class="['color-trigger', { 'color-trigger--property': isProperty }]" size="xs" variant="ghost" theme="gray" :style="{ '--color': color }" :label="label" :tooltip="label" />
      </template>
      <div :class="['color-picker', { 'color-picker--property': isProperty, 'color-picker--property-object': isPropertyObject }]">
        <section v-if="!isProperty">
          <h3>Most used custom colors</h3>
          <div class="color-row">
            <button v-for="color in recent" :key="color" :style="{ background: color }" :aria-label="color" @click="selectColor(color)" />
          </div>
        </section>
        <template v-if="isPropertyObject">
          <section>
            <h3>{{ primaryLabel }}</h3>
            <div class="color-grid">
              <button class="none-color" :aria-label="`No ${primaryLabel.toLowerCase()}`" @click="selectColor(undefined, undefined, primaryTarget)">None</button>
              <button v-for="option in primaryPalette" :key="option.family.name" :class="{ selected: selectionTarget === primaryTarget && family.name === option.family.name }" :style="{ background: option.color }" :aria-label="`${option.family.name} ${primaryLabel.toLowerCase()}`" @click="selectColor(option.color, option.family, primaryTarget)" />
            </div>
          </section>
          <section>
            <h3>{{ secondaryLabel }}</h3>
            <div class="color-grid">
              <button class="none-color" :aria-label="`No ${secondaryLabel.toLowerCase()}`" @click="selectColor(undefined, undefined, secondaryTarget)">None</button>
              <button v-for="option in propertyBorderPalette" :key="option.family.name" :class="{ selected: selectionTarget === secondaryTarget && family.name === option.family.name }" :style="{ background: option.color }" :aria-label="`${option.family.name} ${secondaryLabel.toLowerCase()}`" @click="selectColor(option.color, option.family, secondaryTarget)" />
            </div>
          </section>
        </template>
        <section v-else>
          <h3>Colors</h3>
          <div class="color-grid">
            <button class="none-color" :aria-label="`No ${selectionTarget} color`" @click="selectColor(undefined)">None</button>
            <button v-for="option in (isProperty ? propertyPalette : palette)" :key="option.family.name" :class="{ selected: family.name === option.family.name }" :style="{ background: option.color }" :aria-label="option.family.name" @click="selectColor(option.color, option.family)" />
          </div>
        </section>
        <section v-if="showBorderOptions">
          <h3>Border thickness</h3>
          <div class="border-options">
            <button v-for="option in borderWidths" :key="option.label" :class="['stroke-option', { selected: props.strokeWidth === option.value }]" :aria-label="option.label" @click="emit('style', { strokeWidth: option.value })">
              <svg viewBox="0 0 28 12" aria-hidden="true"><path d="M2 6h24" :stroke-width="option.value" /></svg>
            </button>
          </div>
        </section>
        <section v-if="showBorderOptions">
          <h3>Border style</h3>
          <div class="border-options">
            <button v-for="option in borderStyles" :key="option.value" :class="['stroke-option', { selected: props.strokeStyle === option.value }]" :aria-label="option.label" @click="emit('style', { strokeStyle: option.value })">
              <svg viewBox="0 0 28 12" aria-hidden="true"><path d="M2 6h24" :class="option.value" /></svg>
            </button>
          </div>
        </section>
        <section>
          <h3>{{ shadeLabel }}</h3>
          <div class="color-row">
            <button v-for="color in shades" :key="color" :class="{ selected: color === hex }" :style="{ background: color }" :aria-label="color" @click="selectColor(color)" />
          </div>
        </section>
        <TextInput class="hex-field" :model-value="hex.slice(1)" size="sm" variant="outline" aria-label="Custom hex color" maxlength="6" @update:model-value="updateHex(`#${$event.replace(/^#/, '')}`)">
          <template #prefix><span class="hex-prefix">#</span></template>
          <template #suffix>
            <Button size="xs" variant="ghost" theme="gray" icon="lucide-pipette" label="Color Picker" tooltip="Color Picker" @click="pickScreenColor" />
          </template>
        </TextInput>
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.color-trigger-anchor { display: contents; }
.color-trigger-anchor :deep(.color-trigger) { width: 26px !important; height: 26px !important; padding: 0; border-radius: 5px !important; background: var(--color) !important; }
.color-trigger-anchor :deep(.color-trigger--property) { width: 28px !important; height: 28px !important; padding: 0 6px; border-radius: 6px !important; background: conic-gradient(from 45deg, #ef4444, #f59e0b, #10b981, #3b82f6, #a855f7, #ef4444) !important; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); }
.color-trigger-anchor :deep(.color-trigger .truncate) { display: none; }
.color-picker { width: 264px; padding: 18px; color: var(--ink-gray-7); }
.color-picker--property { width: 198px; padding: 14px; }
.color-picker--property-object { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; width: 386px; }
.color-picker section + section { margin-top: 16px; }
.color-picker--property section + section { margin-top: 12px; }
.color-picker--property-object section + section { margin-top: 0; }
h3 { margin: 0 0 8px; color: var(--ink-gray-7); font-size: 13px; font-weight: 400; line-height: 20px; }
.color-picker--property h3 { margin-bottom: 6px; }
.color-row, .color-grid { display: grid; grid-template-columns: repeat(5, 34px); gap: 6px; }
.color-picker--property .color-row, .color-picker--property .color-grid { grid-template-columns: repeat(5, 30px); gap: 5px; }
.color-picker--property-object .color-row { grid-template-columns: repeat(5, 26px); gap: 4px; }
.color-picker--property-object .color-grid { grid-template-columns: repeat(6, 26px); gap: 4px; }
.color-row button, .color-grid button { width: 34px; height: 34px; padding: 0; border: 0; border-radius: 6px; cursor: pointer; }
.color-picker--property .color-row button, .color-picker--property .color-grid button { width: 30px; height: 30px; }
.color-picker--property-object .color-row button, .color-picker--property-object .color-grid button { width: 26px; height: 26px; }
.none-color { border: 1px solid var(--outline-gray-2) !important; background: linear-gradient(45deg, rgb(82 82 82 / 42%) 25%, transparent 25%) 0 0 / 8px 8px, linear-gradient(-45deg, rgb(82 82 82 / 42%) 25%, transparent 25%) 0 4px / 8px 8px, linear-gradient(45deg, transparent 75%, rgb(82 82 82 / 42%) 75%) 4px -4px / 8px 8px, linear-gradient(-45deg, transparent 75%, rgb(82 82 82 / 42%) 75%) -4px 0 / 8px 8px, var(--surface-base) !important; color: transparent; font-size: 0; }
.none-color:hover { color: var(--ink-gray-9); }
.color-row button:hover, .color-grid button:hover { outline: 1px solid var(--outline-gray-4); outline-offset: 1px; }
.color-row button:focus-visible, .color-grid button:focus-visible, .color-row button.selected, .color-grid button.selected { outline: 2px solid var(--surface-blue-2); outline-offset: 2px; }
.color-picker :deep(.hex-field) { margin-top: 16px; }
.color-picker--property :deep(.hex-field) { margin-top: 12px; }
.color-picker--property-object :deep(.hex-field) { width: 100%; margin-top: 0; align-self: end; }
.border-options { display: flex; gap: 5px; }
.stroke-option { display: flex; width: 30px; height: 26px; align-items: center; justify-content: center; padding: 0; border: 1px solid transparent; border-radius: 5px; background: var(--surface-gray-2); color: var(--ink-gray-7); cursor: pointer; }
.stroke-option.selected, .stroke-option:hover { border-color: var(--outline-blue-2); background: var(--surface-blue-1); }
.stroke-option svg { width: 24px; height: 12px; }
.stroke-option path { fill: none; stroke: currentColor; stroke-linecap: round; }
.stroke-option path.dashed { stroke-dasharray: 5 3; }
.stroke-option path.dotted { stroke-dasharray: 1 3; stroke-linecap: round; stroke-width: 2; }
.color-picker :deep(.hex-field input) { font-weight: 400; line-height: 20px; }
.color-picker :deep(.hex-prefix) { display: flex; width: 24px; height: 24px; align-items: center; justify-content: center; }
</style>
