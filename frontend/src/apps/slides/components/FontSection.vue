<template>
  <Section label="Font">
    <PropertyRow label="Family">
      <Combobox
        trigger="button"
        variant="ghost"
        size="sm"
        align="end"
        :options="textFonts"
        :model-value="displayFont"
        class="-me-1"
        @update:model-value="(value) => updateProperty('fontFamily', value)"
      />
    </PropertyRow>
    <NumberControl
      :model-value="editorStyles.fontSize"
      label="Size"
      suffix="px"
      :min="5"
      :max="800"
      :max-digits="3"
      :step="1"
      @update:model-value="(value) => updateProperty('fontSize', value)"
    />
    <PropertyRow label="Color">
      <ColorPicker
        :model-value="editorStyles.color"
        @update:model-value="(value) => updateProperty('color', value)"
      />
    </PropertyRow>
    <ToggleGroup
      label="Style"
      :model-value="decorValues"
      :options="decorOptions"
      @update:model-value="onDecorToggle"
    />
    <PropertyRow label="Case">
      <TabButtons
        :model-value="editorStyles.textTransform"
        :options="caseOptions"
        @update:model-value="(value) => updateProperty('textTransform', value)"
      />
    </PropertyRow>
  </Section>
</template>

<script setup>
import { Combobox, TabButtons } from 'frappe-ui'
import { Bold, Italic, Strikethrough, Underline } from 'lucide-vue-next'
import { computed } from 'vue'

import ColorPicker from '@/apps/slides/components/controls/ColorPicker.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import Section from '@/apps/slides/components/controls/Section.vue'
import ToggleGroup from '@/apps/slides/components/controls/ToggleGroup.vue'
import { useTextEditor } from '@/apps/slides/composables/useTextEditor'

const { editorStyles, updateProperty, toggleMark } = useTextEditor()

const textFonts = [
  'Anton',
  'Arial',
  'Arial Black',
  'Comic Sans MS',
  'Courier New',
  'Courier Prime',
  'Georgia',
  'Helvetica',
  'Impact',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Palatino Linotype',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Inter',
]

const decorOptions = [
  { value: 'bold', label: 'Bold', icon: Bold },
  { value: 'italic', label: 'Italic', icon: Italic },
  { value: 'underline', label: 'Underline', icon: Underline },
  { value: 'strike', label: 'Strikethrough', icon: Strikethrough },
]

const caseOptions = [
  { value: 'none', tooltip: 'As typed', icon: 'lucide-ban' },
  { value: 'uppercase', tooltip: 'Uppercase', icon: 'lucide-case-upper' },
  { value: 'lowercase', tooltip: 'Lowercase', icon: 'lucide-case-lower' },
]

const displayFont = computed(() => editorStyles.fontFamily?.replace(/['"]/g, ''))

const decorValues = computed(() =>
  decorOptions.flatMap((option) => (editorStyles[option.value] ? [option.value] : [])),
)

const onDecorToggle = (values) => {
  const changed = decorOptions.find(
    (option) => decorValues.value.includes(option.value) !== values.includes(option.value),
  )
  if (changed) toggleMark(changed.value)
}
</script>
