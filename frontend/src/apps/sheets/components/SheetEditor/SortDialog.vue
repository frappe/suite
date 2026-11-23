<template>
  <!-- Sort range, as in Google Sheets: the menu's sort with its guesses shown -->
  <Dialog v-model:open="show" :title="__('Sort {0}', [rangeLabel])" size="sm">
    <template #default>
      <div class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-3">
          <FormControl
            v-model="column"
            type="select"
            :label="__('Sort by')"
            :options="columnOptions"
          />
          <FormControl
            v-model="direction"
            type="select"
            :label="__('Order')"
            :options="directionOptions"
          />
        </div>
        <Checkbox v-model="header" :label="__('Data has a header row')" />
        <Checkbox
          v-if="hasTotals"
          v-model="totals"
          :label="__('Leave the last row of totals out')"
        />
      </div>
    </template>
    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button variant="solid" :label="__('Sort')" @click="apply" />
        <Button :label="__('Cancel')" @click="show = false" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Checkbox, Dialog, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { Rect } from '../../engine/types'
import { cellId, colLabel } from '../../utils/cells'

type Direction = 'asc' | 'desc'

const emit = defineEmits<{
  apply: [sort: { rect: Rect; col: number; dir: Direction; header: boolean; totals: boolean }]
}>()

const show = ref(false)
const rect = ref<Rect>({ r0: 0, c0: 0, r1: 0, c1: 0 })
const column = ref('0')
const direction = ref<Direction>('asc')
const header = ref(false)
const hasTotals = ref(false)
const totals = ref(false)

const rangeLabel = computed(() => {
  const { r0, c0, r1, c1 } = rect.value
  return `${cellId(r0, c0)}:${cellId(r1, c1)}`
})
const columnOptions = computed(() =>
  Array.from({ length: rect.value.c1 - rect.value.c0 + 1 }, (_, i) => {
    const col = rect.value.c0 + i
    return { label: __('Column {0}', [colLabel(col)]), value: String(col) }
  }),
)
const directionOptions = computed(() => [
  { label: __('A → Z'), value: 'asc' },
  { label: __('Z → A'), value: 'desc' },
])

function open(guess: { rect: Rect; col: number; header: boolean; totals: boolean }) {
  rect.value = guess.rect
  column.value = String(guess.col)
  direction.value = 'asc'
  header.value = guess.header
  hasTotals.value = guess.totals
  totals.value = guess.totals
  show.value = true
}

function apply() {
  show.value = false
  emit('apply', {
    rect: rect.value,
    col: Number(column.value),
    dir: direction.value,
    header: header.value,
    totals: totals.value,
  })
}

defineExpose({ open })
</script>
