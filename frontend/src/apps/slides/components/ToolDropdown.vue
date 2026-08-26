<template>
	<Dropdown :options="options" side="top" align="center" :offset="12">
		<template #default="{ open }">
			<div>
				<Tooltip :text="tooltip" :hover-delay="0.7">
					<div :class="triggerClass(open)">
						<component :is="icon" class="size-4 stroke-[1.5] text-ink-gray-7" />
						<ChevronDown class="size-3 text-ink-gray-5" />
					</div>
				</Tooltip>
			</div>
		</template>
	</Dropdown>
</template>

<script setup>
import { ChevronDown } from 'lucide-vue-next'

import { Dropdown, Tooltip } from 'frappe-ui'

defineProps({
	tooltip: { type: String, required: true },
	icon: { type: Object, required: true },
	options: { type: Array, required: true },
})

const triggerClass = (open) => [
	'flex cursor-pointer items-center gap-1 rounded-4 py-2 pl-2 pr-1 hover:bg-surface-gray-3',
	{ 'bg-surface-gray-3': open },
]
</script>
