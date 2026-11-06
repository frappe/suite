<template>
  <div class="grid grid-cols-6 gap-1.5 p-1" :style="palette" role="group" :aria-label="__('Color')">
    <!-- A native title: frappe-ui's Tooltip does not open on hover inside the menu -->
    <button
      v-for="swatch in SWATCHES"
      :key="swatch.label"
      type="button"
      class="writer-swatch"
      :class="!swatch.name && 'is-none'"
      :style="highlightSwatchStyle(swatch.name)"
      :aria-label="__(swatch.label)"
      :title="__(swatch.label)"
      @click="emit('pick', swatch.name)"
    />
  </div>
</template>

<script setup lang="ts">
import { translate as __ } from '@/platform/translation'

import { highlightSwatchStyle, paletteVariables, SWATCHES } from '../palette'

const props = defineProps<{ editorElement: Element }>()
const emit = defineEmits<{ pick: [name: string | null] }>()

const palette = paletteVariables(props.editorElement)
</script>
