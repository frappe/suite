<template>
	<Popover side="top" align="center" :offset="12">
		<template #trigger="{ open }">
			<div :class="triggerClass(open)">
				<Table class="size-4.5 stroke-[1.5] text-ink-gray-7" />
			</div>
		</template>
		<template #default="{ close }">
			<div class="p-2">
				<div class="flex flex-col gap-1" @mouseleave="resetHovered">
					<div v-for="row in maxRows" :key="row" class="flex gap-1">
						<div
							v-for="col in maxColumns"
							:key="col"
							class="size-4 cursor-pointer rounded-1 border"
							:class="
								row <= hovered.rows && col <= hovered.columns
									? 'border-outline-gray-3 bg-surface-gray-4'
									: 'border-outline-gray-2'
							"
							@mouseenter="hovered = { rows: row, columns: col }"
							@click="insertTable(row, col, close)"
						></div>
					</div>
				</div>
				<div class="pt-2 text-center text-xs text-ink-gray-6">{{ label }}</div>
			</div>
		</template>
	</Popover>
</template>

<script setup>
import { ref, computed } from 'vue'

import { Table } from 'lucide-vue-next'

import { Popover } from 'frappe-ui'

import { addTableElement } from '@/apps/slides/stores/element'

const maxRows = 6
const maxColumns = 8

const hovered = ref({ rows: 0, columns: 0 })

const label = computed(() =>
	hovered.value.rows ? `${hovered.value.rows} × ${hovered.value.columns}` : 'Insert table',
)

const triggerClass = (isOpen) => [
	'cursor-pointer rounded-4 p-2 hover:bg-surface-gray-3',
	{ 'bg-surface-gray-3': isOpen },
]

const resetHovered = () => {
	hovered.value = { rows: 0, columns: 0 }
}

const insertTable = (rows, columns, close) => {
	close()
	resetHovered()
	addTableElement(rows, columns)
}
</script>
