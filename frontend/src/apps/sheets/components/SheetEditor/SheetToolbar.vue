<template>
  <!-- Read-only viewers: dim the whole bar and swallow pointer events so no
     formatting/insert/chart action is reachable. Undo/Redo and dropdowns
     come along for free without touching each button. -->
  <div
    class="sn-toolbar"
    :class="{ 'sn-toolbar--readonly': readOnly }"
    :aria-disabled="readOnly || undefined"
  >
    <!-- Number format -->
    <Dropdown :options="numberFormatDropdownOptions" class="sn-numfmt">
      <template #default="{ open }">
        <Button
          :variant="open ? 'subtle' : 'ghost'"
          size="sm"
          icon-right="lucide-chevron-down"
          :aria-label="`Number format: ${numberFormatLabel}`"
          tooltip="Number format"
          >{{ numberFormatLabel }}</Button
        >
      </template>
    </Dropdown>
    <Dropdown :options="currencyDropdownOptions" class="sn-currency">
      <template #default="{ open }">
        <Button
          :variant="activeNumberFormatType === 'currency' ? 'subtle' : open ? 'subtle' : 'ghost'"
          size="sm"
          :aria-label="`Currency: ${activeCurrencySymbol}`"
          tooltip="Currency"
          >{{ activeCurrencySymbol }}</Button
        >
      </template>
    </Dropdown>
    <Button
      :variant="activeNumberFormatType === 'percentage' ? 'subtle' : 'ghost'"
      size="sm"
      aria-label="Percentage"
      :aria-pressed="activeNumberFormatType === 'percentage'"
      tooltip="Percentage"
      @click="emit('number-format', 'percentage')"
      >%</Button
    >
    <Button
      :variant="activeNumberFormatType === 'number' ? 'subtle' : 'ghost'"
      size="sm"
      aria-label="Thousands separator"
      :aria-pressed="activeNumberFormatType === 'number'"
      tooltip="Thousands separator"
      @click="emit('number-format', 'number')"
      >,</Button
    >
    <div class="sn-tool-extra">
      <Button
        aria-label="Decrease decimal places"
        variant="ghost"
        size="sm"
        :icon="DecreaseDecimalIcon"
        tooltip="Decrease decimal places"
        @click="emit('adjust-decimals', -1)"
      />
      <Button
        aria-label="Increase decimal places"
        variant="ghost"
        size="sm"
        :icon="IncreaseDecimalIcon"
        tooltip="Increase decimal places"
        @click="emit('adjust-decimals', +1)"
      />
    </div>

    <div class="sn-vr" />

    <!-- Font -->
    <Dropdown :options="fontFamilyDropdownOptions" class="sn-font-family">
      <template #default="{ open }">
        <Button
          :variant="open ? 'subtle' : 'ghost'"
          size="sm"
          icon-right="lucide-chevron-down"
          :aria-label="`Font: ${activeFontFamilyLabel}`"
          tooltip="Font family"
          >{{ activeFontFamilyLabel }}</Button
        >
      </template>
    </Dropdown>
    <!-- The wrapper carries the sizing: TextInput puts `class` on an inner
       element that does not get this component's scoped attribute. -->
    <div class="sn-font-size">
      <Tooltip text="Font size">
        <TextInput
          type="number"
          size="sm"
          aria-label="Font size"
          :model-value="activeFormat.fontSize || 13"
          min="8"
          max="72"
          @change="emit('font-size-input', $event)"
          @keydown.enter.prevent="emit('font-size-input', $event)"
        />
      </Tooltip>
    </div>

    <div class="sn-vr" />

    <!-- Style -->
    <Button
      aria-label="Bold"
      :variant="activeFormat.bold ? 'subtle' : 'ghost'"
      :aria-pressed="!!activeFormat.bold"
      size="sm"
      icon="lucide-bold"
      tooltip="Bold (Ctrl+B)"
      @click="emit('toggle-format', 'bold')"
    />
    <Button
      aria-label="Italic"
      :variant="activeFormat.italic ? 'subtle' : 'ghost'"
      :aria-pressed="!!activeFormat.italic"
      size="sm"
      icon="lucide-italic"
      tooltip="Italic (Ctrl+I)"
      @click="emit('toggle-format', 'italic')"
    />
    <Button
      aria-label="Underline"
      :variant="activeFormat.underline ? 'subtle' : 'ghost'"
      :aria-pressed="!!activeFormat.underline"
      size="sm"
      icon="lucide-underline"
      tooltip="Underline (Ctrl+U)"
      @click="emit('toggle-format', 'underline')"
    />
    <div class="sn-tool-extra">
      <Button
        aria-label="Strikethrough"
        :variant="activeFormat.strikethrough ? 'subtle' : 'ghost'"
        :aria-pressed="!!activeFormat.strikethrough"
        size="sm"
        icon="lucide-strikethrough"
        tooltip="Strikethrough (Ctrl+Shift+X)"
        @click="emit('toggle-format', 'strikethrough')"
      />
    </div>

    <div class="sn-vr" />

    <!-- Align + Color -->
    <Dropdown :options="alignDropdownOptions">
      <template #default="{ open }">
        <Button
          aria-label="Alignment"
          :variant="open ? 'subtle' : 'ghost'"
          size="sm"
          :icon="hAlignIcon"
          tooltip="Alignment"
        />
      </template>
    </Dropdown>
    <ColorPicker
      :model-value="activeFormat.color || ''"
      allow-default
      default-label="Default text color"
      title="Text colour"
      fallback="#171717"
      @update:model-value="emit('set-color', 'color', $event)"
    >
      <template #trigger="{ toggle, open }">
        <Tooltip text="Text colour">
          <button
            type="button"
            class="sn-swatch-btn"
            :class="{ 'is-open': open }"
            aria-label="Text colour"
            @click="toggle()"
          >
            <FeatherIcon name="type" class="sn-swatch-glyph" />
            <span
              class="sn-swatch-underline"
              :style="{ background: activeFormat.color || '#171717' }"
            ></span>
          </button>
        </Tooltip>
      </template>
    </ColorPicker>
    <ColorPicker
      :model-value="activeFormat.backgroundColor || ''"
      allow-default
      default-label="No fill"
      title="Fill colour"
      fallback="#ffffff"
      @update:model-value="emit('set-color', 'backgroundColor', $event)"
    >
      <template #trigger="{ toggle, open }">
        <Tooltip text="Fill colour">
          <button
            type="button"
            class="sn-swatch-btn"
            :class="{ 'is-open': open }"
            aria-label="Fill colour"
            @click="toggle()"
          >
            <FeatherIcon name="droplet" class="sn-swatch-glyph" />
            <span
              class="sn-swatch-underline sn-swatch-fill"
              :style="{ background: activeFormat.backgroundColor || '#ffffff' }"
            ></span>
          </button>
        </Tooltip>
      </template>
    </ColorPicker>

    <div class="sn-vr" />

    <!-- Undo / Redo -->
    <Button
      aria-label="Undo"
      variant="ghost"
      size="sm"
      icon="lucide-corner-up-left"
      tooltip="Undo (Ctrl+Z)"
      :disabled="!canUndo"
      @click="emit('undo')"
    />
    <Button
      aria-label="Redo"
      variant="ghost"
      size="sm"
      icon="lucide-corner-up-right"
      tooltip="Redo (Ctrl+Y)"
      :disabled="!canRedo"
      @click="emit('redo')"
    />

    <div class="sn-vr" />

    <!-- Extra tools (visible at wide widths; hidden at narrow — overflow via ···) -->
    <div class="sn-tool-extra">
      <Button
        aria-label="Format painter"
        :aria-pressed="isPaintingFormat"
        :variant="isPaintingFormat ? 'subtle' : 'ghost'"
        size="sm"
        icon="lucide-paint-roller"
        tooltip="Format painter"
        @click="emit('toggle-format-painter')"
      />
      <Button
        aria-label="Clear formatting"
        variant="ghost"
        size="sm"
        icon="lucide-eraser"
        tooltip="Clear formatting"
        @click="emit('clear-formatting')"
      />
      <div class="sn-vr" />
      <Button
        aria-label="Filter"
        :aria-pressed="showSortFilter"
        :variant="showSortFilter ? 'subtle' : 'ghost'"
        size="sm"
        icon="lucide-filter"
        tooltip="Toggle filter"
        @click="emit('update:showSortFilter', !showSortFilter)"
      />
      <div class="sn-vr" />
      <Dropdown :options="textWrapDropdownOptions">
        <template #default="{ open }">
          <Button
            aria-label="Text wrapping"
            :variant="open ? 'subtle' : 'ghost'"
            size="sm"
            :icon="textWrapIcon"
            tooltip="Text wrapping"
          />
        </template>
      </Dropdown>
      <div class="sn-vr" />
      <Button
        aria-label="Conditional formatting"
        variant="ghost"
        size="sm"
        icon="lucide-blend"
        tooltip="Conditional formatting"
        @click="emit('cond-format')"
      />
      <Button
        aria-label="Insert hyperlink"
        variant="ghost"
        size="sm"
        icon="lucide-link"
        tooltip="Insert hyperlink (Ctrl+L)"
        @click="emit('hyperlink')"
      />
      <div class="sn-vr" />
      <Dropdown :options="borderDropdownOptions">
        <template #default="{ open }">
          <Button
            aria-label="Borders"
            :variant="open ? 'subtle' : 'ghost'"
            size="sm"
            icon="lucide-layout-grid"
            tooltip="Borders"
          />
        </template>
      </Dropdown>
      <!-- Custom merge glyph (Lucide table-cells-merge) — reads as
         "join two cells" better than the generic maximize-2 icon. -->
      <Button
        aria-label="Merge / unmerge cells"
        variant="ghost"
        size="sm"
        tooltip="Merge / unmerge cells"
        @click="emit('merge')"
      >
        <template #icon>
          <svg
            viewBox="0 0 24 24"
            class="sn-merge-glyph"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 21v-6" />
            <path d="M12 9V3" />
            <path d="M3 15h18" />
            <path d="M3 9h18" />
            <rect width="18" height="18" x="3" y="3" rx="2" />
          </svg>
        </template>
      </Button>
      <div class="sn-vr" />
      <Button
        aria-label="Insert chart"
        variant="ghost"
        size="sm"
        icon="lucide-chart-bar"
        tooltip="Insert chart"
        @click="emit('chart')"
      />
    </div>

    <!-- More -->
    <div class="sn-tool-more">
      <Dropdown :options="moreToolbarOptions">
        <template #default="{ open }">
          <Button
            aria-label="More tools"
            :variant="open ? 'subtle' : 'ghost'"
            size="sm"
            icon="lucide-more-horizontal"
            tooltip="More tools"
          />
        </template>
      </Dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
// The formatting toolbar (bar 2), extracted from SheetEditor/index.vue. It
// renders the active cell's format and the menus the editor builds, and
// reports every action back; the formatting itself stays in the editor.
import { Button, Dropdown, TextInput, Tooltip, type DropdownOptions } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { h, type VNode } from 'vue'

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

defineProps<{
  readOnly: boolean
  activeFormat: ActiveFormat
  numberFormatDropdownOptions: DropdownOptions
  numberFormatLabel: string
  currencyDropdownOptions: DropdownOptions
  activeNumberFormatType: string
  activeCurrencySymbol: string
  fontFamilyDropdownOptions: DropdownOptions
  activeFontFamilyLabel: string
  alignDropdownOptions: DropdownOptions
  hAlignIcon: string
  canUndo: boolean
  canRedo: boolean
  isPaintingFormat: boolean
  showSortFilter: boolean
  textWrapDropdownOptions: DropdownOptions
  textWrapIcon: string
  borderDropdownOptions: DropdownOptions
  moreToolbarOptions: DropdownOptions
}>()
const emit = defineEmits<{
  'number-format': [type: 'percentage' | 'number']
  'adjust-decimals': [delta: number]
  'font-size-input': [e: Event]
  'toggle-format': [key: 'bold' | 'italic' | 'underline' | 'strikethrough']
  'set-color': [key: 'color' | 'backgroundColor', value: string]
  undo: []
  redo: []
  'toggle-format-painter': []
  'clear-formatting': []
  'update:showSortFilter': [on: boolean]
  'cond-format': []
  hyperlink: []
  merge: []
  chart: []
}>()

// Custom decimals-with-arrow glyphs for the precision toolbar buttons. Not in
// lucide, so passed as component props through Button's icon API instead of as
// "lucide-…" strings. stroke-width 1.5 keeps the small inner shapes legible at
// 16 px (Button sm icon size). currentColor + stroke → inherits text-ink-gray
// in light + dark mode, same as the neighbouring lucide icons.
function _decimalsIcon(children: VNode[]) {
  return {
    render: () =>
      h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.5,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true',
        },
        children,
      ),
  }
}
const DecreaseDecimalIcon = _decimalsIcon([
  h('path', {
    d: 'm13 21-3-3 3-3',
  }),
  h('path', {
    d: 'M20 18H10',
  }),
  h('path', {
    d: 'M3 11h.01',
  }),
  h('rect', {
    x: 6,
    y: 3,
    width: 5,
    height: 8,
    rx: 2.5,
  }),
])
const IncreaseDecimalIcon = _decimalsIcon([
  h('path', {
    d: 'M10 18h10',
  }),
  h('path', {
    d: 'm17 21 3-3-3-3',
  }),
  h('path', {
    d: 'M3 11h.01',
  }),
  h('rect', {
    x: 15,
    y: 3,
    width: 5,
    height: 8,
    rx: 2.5,
  }),
  h('rect', {
    x: 6,
    y: 3,
    width: 5,
    height: 8,
    rx: 2.5,
  }),
])
</script>

<style scoped>
/* ── Bar 3 · Formatting toolbar ──────────────────────────────────────────── */
.sn-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 44px;
  padding: 0 15px;
  border-bottom: 1px solid var(--outline-gray-2);
  background: var(--surface-base);
  flex-shrink: 0;
}
/* A phone-width bar scrolls sideways instead of clipping the controls at
   its end (including the "…" menu). Menus and tooltips are portalled, so
   the scroll box does not clip them. */
@media (max-width: 720px) {
  .sn-toolbar {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .sn-toolbar::-webkit-scrollbar {
    display: none;
  }
}
/* Read-only: dim and make the whole formatting bar inert. pointer-events:none
   swallows clicks on every control (buttons + dropdowns) without per-button
   wiring; the reduced opacity is the visual "disabled" cue. */
.sn-toolbar--readonly {
  opacity: 0.45;
  pointer-events: none;
}
.sn-toolbar :deep(.fui-form-control) {
  width: auto;
}
.sn-toolbar :deep(select) {
  min-width: 118px;
}
/* Font family dropdown — uses a Button trigger that hugs the short label. */
.sn-font-family :deep(button) {
  padding-left: 6px;
  padding-right: 4px;
  gap: 2px;
}

/* flex-shrink:0 — the input has no min-content width, so a narrow bar would
   squeeze it until the size is hidden. */
.sn-font-size {
  width: 52px;
  margin: 0 2px;
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
.sn-vr {
  width: 1px;
  height: 18px;
  background: var(--outline-gray-2);
  margin: 0 6px;
  flex-shrink: 0;
}

/* Toolbar overflow — `.sn-tool-extra` groups stay inline at wide widths and
   collapse below 1280px into the `.sn-tool-more` "…" dropdown. Using
   `display:contents` on the wrappers means the buttons participate in the
   parent flex layout when shown, with zero visual nesting.

   The "…" button itself is shown at every width: it is the only mouse path to
   the actions that have no toolbar button of their own (pivot table, named
   ranges, zoom, Smart Fill). `buildMoreToolbarOptions` drops the options that
   are already inline, so the menu never repeats a visible button — keep its
   `collapsed` argument in sync with the breakpoint below. */
.sn-tool-extra {
  display: contents;
}
.sn-tool-more {
  display: inline-flex;
  margin-left: auto;
}
@media (max-width: 1280px) {
  .sn-tool-extra {
    display: none;
  }
}

/* Color-picker trigger buttons (FeatherIcon glyph above a colored underline).
   These open the ColorPicker popover; the swatch grid + hex + custom live there. */
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
  border: 1px solid transparent;
  gap: 1px;
  transition: background-color 0.12s;
  background: transparent;
  padding: 0;
}
.sn-swatch-btn:hover,
.sn-swatch-btn.is-open {
  background: var(--surface-gray-3);
}
.sn-swatch-glyph {
  width: 14px;
  height: 14px;
  color: var(--ink-gray-8);
  pointer-events: none;
}
.sn-merge-glyph {
  width: 16px;
  height: 16px;
  color: currentColor;
  pointer-events: none;
}
.sn-swatch-underline {
  width: 16px;
  height: 3px;
  border-radius: 1px;
  pointer-events: none;
}
.sn-swatch-fill {
  border: 1px solid var(--outline-gray-2);
}
</style>
