<template>
	<div class="flex flex-col" :aria-label="__('Loading')" role="status">
		<div class="flex items-center gap-4 border-b py-2">
			<Skeleton v-for="column in columns" :key="column" class="h-3 flex-1 rounded-4" />
		</div>
		<div v-for="row in rows" :key="row" class="flex items-center gap-4 py-3.5">
			<Skeleton
				v-for="column in columns"
				:key="column"
				class="h-3.5 flex-1 rounded-4"
				:style="{ maxWidth: `${widthFor(row, column)}%` }"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Skeleton } from 'frappe-ui'

const { rows = 8, columns = 4 } = defineProps<{ rows?: number; columns?: number }>()

// Deterministic pseudo-random widths so the placeholder reads as text of
// varying length instead of a uniform grid.
const widthFor = (row: number, column: number) => 45 + ((row * 7 + column * 13) % 40)
</script>
