<template>
  <Section label="Table">
    <NumberControl
      :modelValue="table.size.rows"
      label="Rows"
      :min="table.minSize.rows"
      :max="20"
      :max-digits="2"
      :step="1"
      @update:modelValue="(value) => setRowCount(value, table.size.rows)"
    />
    <NumberControl
      :modelValue="table.size.columns"
      label="Columns"
      :min="table.minSize.columns"
      :max="20"
      :max-digits="2"
      :step="1"
      @update:modelValue="(value) => setColumnCount(value, table.size.columns)"
    />
    <PropertyRow label="Headers">
      <Select
        :modelValue="headerMode"
        variant="ghost"
        :options="headerOptions"
        class="-me-1"
        @update:modelValue="setHeaderMode"
      >
        <template #trigger="{ selectedOption }">
          <span :class="valueClasses">{{ selectedOption?.label }}</span>
          <span :class="chevronClasses" />
        </template>
      </Select>
    </PropertyRow>
    <PropertyRow
      label="Banded rows"
      class="cursor-pointer"
      @click="toggleFromRow($event, () => setBandedRows(!activeElement.bandedRows))"
    >
      <Switch :modelValue="activeElement.bandedRows || false" @update:modelValue="setBandedRows" />
    </PropertyRow>
    <PropertyRow v-if="activeElement.bandedRows" label="Band color">
      <ColorPicker
        :modelValue="activeElement.bandColor || getDefaultBandColor(activeElement.color)"
        @update:modelValue="bandColor.set"
        @colordown="bandColor.begin"
        @colorup="bandColor.commit"
      />
    </PropertyRow>
  </Section>
</template>

<script setup>
import { Select, Switch } from 'frappe-ui'
import { computed } from 'vue'

import ColorPicker from '@/apps/slides/components/controls/ColorPicker.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import Section from '@/apps/slides/components/controls/Section.vue'
import { setElementProperty, useElementProperty } from '@/apps/slides/composables/editProperty'
import { activeElement } from '@/apps/slides/stores/element'
import { getDefaultBandColor } from '@/apps/slides/utils/color'
import { chevronClasses } from '@/apps/slides/utils/constants'
import { setColumnCount, setRowCount, setTableHeaders } from '@/apps/slides/utils/tableStructure'
import { getTableInfo } from '@/apps/slides/utils/tableWidths'

const table = computed(() => getTableInfo(activeElement.value.content))

const headerOptions = [
  { label: 'None', value: 'none' },
  { label: 'Row', value: 'row' },
  { label: 'Column', value: 'column' },
  { label: 'Both', value: 'both' },
]

const headerMode = computed(() => {
  const { row, column } = table.value.headers
  if (row && column) return 'both'
  if (row) return 'row'
  if (column) return 'column'
  return 'none'
})

const setHeaderMode = (value) =>
  setTableHeaders({
    row: value === 'row' || value === 'both',
    column: value === 'column' || value === 'both',
  })

// the switch handles its own clicks; the rest of the row forwards to it
const toggleFromRow = (e, toggle) => {
  if (!e.target.closest('button')) toggle()
}

const setBandedRows = (value) => setElementProperty('bandedRows', value)

const bandColor = useElementProperty('bandColor')

const valueClasses = 'block font-text text-base text-ink-gray-8'
</script>
