<template>
	<div class="flex items-center whitespace-nowrap">
		<Button
			class="text-base h-7 border-r border-outline-gray-2 rounded-r-none"
			:disabled
			@click="toggleAscending"
		>
			<template #icon>
				<LucideArrowDownAz v-if="sortOrder.ascending" class="size-4" />
				<LucideArrowUpZa v-else class="size-4" />
			</template>
		</Button>

		<Dropdown :options="orderByItems" align="end">
			<Button class="text-base h-7 rounded-l-none" :disabled>
				<span class="flex items-center gap-2">
					{{ __(sortOrder.label) }}
					<LucideSparkles v-if="sortOrder.smart" class="size-3" />
				</span>
			</Button>
		</Dropdown>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { Button, Dropdown } from 'frappe-ui'
import type { DropdownOption } from 'frappe-ui'

type SortOrder = {
	label: string
	field: string
	ascending: boolean
	smart?: boolean
}

type SortField = {
	label: string
	field: string
}

const sortOrder = defineModel<SortOrder>({ required: true })

const props = defineProps<{
	options: SortField[]
	menuItems?: DropdownOption[]
	disabled?: boolean
}>()

const toggleAscending = () => {
	sortOrder.value.ascending = !sortOrder.value.ascending
}

const orderByItems = computed<DropdownOption[]>(() => [
	...props.options.map((option) => ({
		label: option.label,
		onClick: () => {
			sortOrder.value.field = option.field
			sortOrder.value.label = option.label
		},
	})),
	...(props.menuItems ?? []),
])
</script>
