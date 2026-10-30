<template>
  <!-- Row 2 of the top area: history, the formula bar (the editor's `formula`
     slot), then the formatting people reach for most. Everything else is in
     the menus, and the Format button opens the Format menu right here. -->
  <div class="sn-toolbar">
    <!-- Viewers can still use the name box and read the formula bar; only
       the tool groups go inert. -->
    <div class="sn-group" :class="tools" :aria-disabled="readOnly || undefined">
      <Button
        :aria-label="__('Undo')"
        variant="ghost"
        size="sm"
        icon="lucide-undo-2"
        :tooltip="__('Undo (Ctrl+Z)')"
        :disabled="!canUndo"
        @click="emit('undo')"
      />
      <Button
        class="sn-phone-hide"
        :aria-label="__('Redo')"
        variant="ghost"
        size="sm"
        icon="lucide-redo-2"
        :tooltip="__('Redo (Ctrl+Y)')"
        :disabled="!canRedo"
        @click="emit('redo')"
      />
      <Button
        class="sn-phone-hide"
        :aria-label="__('Format painter')"
        :aria-pressed="isPaintingFormat"
        :variant="isPaintingFormat ? 'subtle' : 'ghost'"
        size="sm"
        icon="lucide-paint-roller"
        :tooltip="__('Format painter')"
        @click="emit('toggle-format-painter')"
      />
    </div>

    <div class="sn-vr" />

    <slot name="formula" />

    <!-- The tools between the formula bar and Format scroll sideways when a
       narrow bar still can't fit them; the formula bar stays outside the
       scroll box so its suggestions are never clipped. -->
    <div class="sn-tools-scroll">
      <div class="sn-group" :class="tools" :aria-disabled="readOnly || undefined">
        <Dropdown :options="numberFormatDropdownOptions">
          <template #default="{ open }">
            <Button
              :variant="open ? 'subtle' : 'ghost'"
              size="sm"
              icon-right="lucide-chevron-down"
              :aria-label="__('Number format: {0}', [numberFormatLabel])"
              :tooltip="__('Number format: {0}', [numberFormatLabel])"
              >123</Button
            >
          </template>
        </Dropdown>
        <Dropdown :options="currencyDropdownOptions">
          <template #default="{ open }">
            <Button
              :variant="activeNumberFormatType === 'currency' || open ? 'subtle' : 'ghost'"
              size="sm"
              :icon="currencyIcon"
              :aria-label="__('Currency: {0}', [activeCurrencySymbol])"
              :tooltip="__('Currency')"
            />
          </template>
        </Dropdown>
        <Button
          :variant="activeNumberFormatType === 'percentage' ? 'subtle' : 'ghost'"
          size="sm"
          icon="lucide-percent"
          :aria-label="__('Percent')"
          :aria-pressed="activeNumberFormatType === 'percentage'"
          :tooltip="__('Percent')"
          @click="emit('number-format', 'percentage')"
        />
        <Button
          :aria-label="__('Fewer decimal places')"
          variant="ghost"
          size="sm"
          icon="lucide-decimals-arrow-left"
          :tooltip="__('Fewer decimal places')"
          @click="emit('adjust-decimals', -1)"
        />
        <Button
          :aria-label="__('More decimal places')"
          variant="ghost"
          size="sm"
          icon="lucide-decimals-arrow-right"
          :tooltip="__('More decimal places')"
          @click="emit('adjust-decimals', +1)"
        />
      </div>

      <div class="sn-vr" />

      <div class="sn-group" :class="tools" :aria-disabled="readOnly || undefined">
        <!-- The wrapper carries the sizing: TextInput puts `class` on an inner
         element that does not get this component's scoped attribute. -->
        <div class="sn-font-size">
          <Tooltip :text="__('Font size')">
            <TextInput
              type="number"
              size="sm"
              variant="ghost"
              :aria-label="__('Font size')"
              :model-value="activeFormat.fontSize || 13"
              min="8"
              max="72"
              @change="emit('font-size-input', $event)"
              @keydown.enter.prevent="emit('font-size-input', $event)"
            />
          </Tooltip>
        </div>
        <Button
          :aria-label="__('Bold')"
          :variant="activeFormat.bold ? 'subtle' : 'ghost'"
          :aria-pressed="!!activeFormat.bold"
          size="sm"
          icon="lucide-bold"
          :tooltip="__('Bold (Ctrl+B)')"
          @click="emit('toggle-format', 'bold')"
        />
        <Button
          :aria-label="__('Italic')"
          :variant="activeFormat.italic ? 'subtle' : 'ghost'"
          :aria-pressed="!!activeFormat.italic"
          size="sm"
          icon="lucide-italic"
          :tooltip="__('Italic (Ctrl+I)')"
          @click="emit('toggle-format', 'italic')"
        />
        <Button
          :aria-label="__('Strikethrough')"
          :variant="activeFormat.strikethrough ? 'subtle' : 'ghost'"
          :aria-pressed="!!activeFormat.strikethrough"
          size="sm"
          icon="lucide-strikethrough"
          :tooltip="__('Strikethrough (Ctrl+Shift+X)')"
          @click="emit('toggle-format', 'strikethrough')"
        />
        <ColorPicker
          :model-value="activeFormat.color || ''"
          allow-default
          :default-label="__('Default text color')"
          :title="__('Text colour')"
          fallback="#171717"
          @update:model-value="emit('set-color', 'color', $event)"
        >
          <template #trigger="{ toggle, open }">
            <Tooltip :text="__('Text colour')">
              <button
                type="button"
                class="sn-swatch-btn"
                :class="{ 'is-open': open }"
                :aria-label="__('Text colour')"
                @click="toggle()"
              >
                <span class="lucide-type sn-swatch-glyph" aria-hidden="true" />
                <span
                  class="sn-swatch-underline"
                  :style="{ background: activeFormat.color || 'var(--ink-gray-9)' }"
                ></span>
              </button>
            </Tooltip>
          </template>
        </ColorPicker>
        <ColorPicker
          :model-value="activeFormat.backgroundColor || ''"
          allow-default
          :default-label="__('No fill')"
          :title="__('Fill colour')"
          fallback="#ffffff"
          @update:model-value="emit('set-color', 'backgroundColor', $event)"
        >
          <template #trigger="{ toggle, open }">
            <Tooltip :text="__('Fill colour')">
              <button
                type="button"
                class="sn-swatch-btn"
                :class="{ 'is-open': open }"
                :aria-label="__('Fill colour')"
                @click="toggle()"
              >
                <span class="lucide-paint-bucket sn-swatch-glyph" aria-hidden="true" />
                <span
                  class="sn-swatch-underline sn-swatch-fill"
                  :style="{ background: activeFormat.backgroundColor || 'var(--surface-base)' }"
                ></span>
              </button>
            </Tooltip>
          </template>
        </ColorPicker>
      </div>

      <!-- A narrow bar drops this group first: all four live in the Format menu. -->
      <div class="sn-vr sn-layout" />
      <div class="sn-group sn-layout" :class="tools" :aria-disabled="readOnly || undefined">
        <Dropdown :options="borderDropdownOptions">
          <template #default="{ open }">
            <Button
              :aria-label="__('Borders')"
              :variant="open ? 'subtle' : 'ghost'"
              size="sm"
              icon="lucide-grid-2x2"
              :tooltip="__('Borders')"
            />
          </template>
        </Dropdown>
        <Button
          :aria-label="__('Merge cells')"
          variant="ghost"
          size="sm"
          icon="lucide-table-cells-merge"
          :tooltip="__('Merge or unmerge cells')"
          @click="emit('merge')"
        />
        <Dropdown :options="alignDropdownOptions">
          <template #default="{ open }">
            <Button
              :aria-label="__('Alignment')"
              :variant="open ? 'subtle' : 'ghost'"
              size="sm"
              :icon="hAlignIcon"
              :tooltip="__('Alignment')"
            />
          </template>
        </Dropdown>
        <Dropdown :options="textWrapDropdownOptions">
          <template #default="{ open }">
            <Button
              :aria-label="__('Text wrapping')"
              :variant="open ? 'subtle' : 'ghost'"
              size="sm"
              :icon="textWrapIcon"
              :tooltip="__('Text wrapping')"
            />
          </template>
        </Dropdown>
      </div>

      <!-- Then this one: both are in the Data menu. -->
      <div class="sn-vr sn-data" />
      <div class="sn-group sn-data" :class="tools" :aria-disabled="readOnly || undefined">
        <Button
          :aria-label="__('Sort')"
          variant="ghost"
          size="sm"
          icon="lucide-arrow-down-wide-narrow"
          :tooltip="__('Sort and filter this column (Alt+↓)')"
          @click="emit('sort')"
        />
        <Button
          :aria-label="__('Filter')"
          :aria-pressed="showSortFilter"
          :variant="showSortFilter ? 'subtle' : 'ghost'"
          size="sm"
          icon="lucide-funnel"
          :tooltip="__('Filter')"
          @click="emit('update:showSortFilter', !showSortFilter)"
        />
      </div>
    </div>

    <div class="sn-group" :class="tools" :aria-disabled="readOnly || undefined">
      <Dropdown :options="formatMenuOptions" align="end">
        <template #default="{ open }">
          <Button
            class="sn-format-btn"
            :variant="open ? 'subtle' : 'outline'"
            size="sm"
            icon-left="lucide-sliders-horizontal"
            :label="__('Format')"
            :aria-label="__('Format')"
          />
        </template>
      </Dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
// Row 2 of the top area. It renders the active cell's format and the menus the
// editor builds, and reports every action back; the formatting itself stays
// in the editor.
import { Button, Dropdown, TextInput, Tooltip, type DropdownOptions } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import ColorPicker from './ColorPicker.vue'

type ActiveFormat = {
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  color?: string
  backgroundColor?: string
}

const props = defineProps<{
  readOnly: boolean
  activeFormat: ActiveFormat
  numberFormatDropdownOptions: DropdownOptions
  numberFormatLabel: string
  currencyDropdownOptions: DropdownOptions
  activeNumberFormatType: string
  activeCurrencySymbol: string
  alignDropdownOptions: DropdownOptions
  hAlignIcon: string
  canUndo: boolean
  canRedo: boolean
  isPaintingFormat: boolean
  showSortFilter: boolean
  textWrapDropdownOptions: DropdownOptions
  textWrapIcon: string
  borderDropdownOptions: DropdownOptions
  /** The menu bar's Format menu, opened by the Format button. */
  formatMenuOptions: DropdownOptions
}>()
const emit = defineEmits<{
  'number-format': [type: 'percentage']
  'adjust-decimals': [delta: number]
  'font-size-input': [e: Event]
  'toggle-format': [key: 'bold' | 'italic' | 'strikethrough']
  'set-color': [key: 'color' | 'backgroundColor', value: string]
  undo: []
  redo: []
  'toggle-format-painter': []
  'update:showSortFilter': [on: boolean]
  merge: []
  sort: []
}>()

const tools = computed(() => ({ 'sn-tools--readonly': props.readOnly }))

// Lucide draws each currency the toolbar offers, so the button keeps the
// same stroke as its neighbours instead of a text glyph.
const CURRENCY_ICONS: Record<string, string> = {
  $: 'lucide-dollar-sign',
  '€': 'lucide-euro',
  '£': 'lucide-pound-sterling',
  '₹': 'lucide-indian-rupee',
  '¥': 'lucide-japanese-yen',
}
const currencyIcon = computed(
  () => CURRENCY_ICONS[props.activeCurrencySymbol] ?? 'lucide-dollar-sign',
)
</script>

<style scoped>
/* ── Row 2 · tools + formula bar (36 px, B5) ─────────────────────────────── */
.sn-toolbar {
  container: sn-toolbar / inline-size;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 8px;
  border-bottom: 1px solid var(--outline-gray-2);
  background: var(--surface-base);
  flex-shrink: 0;
}
/* The middle tools: they shrink after the formula bar has reached its
   minimum, and scroll instead of clipping. Menus, tooltips and the colour
   popovers are portalled, so the scroll box does not clip them. */
.sn-tools-scroll {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  /* Thin but visible, so a mouse user can tell more tools are there. */
  scrollbar-width: thin;
}
.sn-group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
/* Read-only: the tools dim and go inert; the formula bar stays usable. */
.sn-tools--readonly {
  opacity: 0.45;
  pointer-events: none;
}
/* Groups sit 8 px apart with a hairline between them, buttons 2 px apart
   inside one: the gap alone says where a group ends. */
.sn-vr {
  width: 1px;
  height: 18px;
  background: var(--outline-gray-2);
  flex-shrink: 0;
}

/* Overflow only when the bar is narrow: the layout tools go first, then
   sort and filter. Nothing is lost, the menus hold both groups. */
@container sn-toolbar (max-width: 1040px) {
  .sn-layout {
    display: none;
  }
}
/* A phone keeps undo, the formula bar, a swipeable strip of tools and an
   icon-only Format; redo and the painter are in the Edit and Format menus. */
@container sn-toolbar (max-width: 480px) {
  .sn-toolbar :deep(.sn-phone-hide) {
    display: none;
  }
  .sn-toolbar :deep(.sn-formula-wrap) {
    min-width: 96px;
  }
  .sn-toolbar :deep(.sn-cell-ref) {
    width: 52px;
  }
  /* Format keeps its icon; the room goes to the tools, which scroll. */
  .sn-toolbar :deep(.sn-format-btn .truncate) {
    display: none;
  }
}
@container sn-toolbar (max-width: 880px) {
  .sn-data {
    display: none;
  }
}

/* flex-shrink:0 — the input has no min-content width, so a narrow bar would
   squeeze it until the size is hidden. */
.sn-font-size {
  width: 44px;
  flex-shrink: 0;
}
.sn-font-size :deep(input) {
  text-align: center;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}
.sn-font-size :deep(input::-webkit-outer-spin-button),
.sn-font-size :deep(input::-webkit-inner-spin-button) {
  -webkit-appearance: none;
  margin: 0;
}
.sn-toolbar :deep(.sn-format-btn) {
  margin-left: 4px;
}

/* Colour buttons: the Lucide glyph over a bar in the current colour. They
   open the ColorPicker popover. */
.sn-swatch-btn {
  position: relative;
  height: 28px;
  width: 28px;
  border-radius: 6px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 0;
  gap: 1px;
  transition: background-color 0.12s;
  background: transparent;
  padding: 0;
  color: var(--ink-gray-7);
}
.sn-swatch-btn:hover,
.sn-swatch-btn.is-open {
  background: var(--surface-gray-3);
}
.sn-swatch-btn:focus-visible {
  outline: 2px solid var(--outline-gray-3);
  outline-offset: 0;
}
.sn-swatch-glyph {
  width: 14px;
  height: 14px;
  pointer-events: none;
}
.sn-swatch-underline {
  width: 16px;
  height: 3px;
  border-radius: 1px;
  pointer-events: none;
}
.sn-swatch-fill {
  box-shadow: inset 0 0 0 1px var(--outline-gray-3);
}
</style>
