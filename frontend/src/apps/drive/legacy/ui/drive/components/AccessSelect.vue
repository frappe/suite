<template>
	<Select :variant :options>
		<template #item-prefix="{ item }">
			<span v-if="item.icon" :class="[item.icon, 'size-4 shrink-0', iconClass(item)]" />
		</template>
		<template #item-label="{ item }">
			<span :class="item.value === 'remove' && 'text-ink-red-6'">{{ item.label }}</span>
		</template>
	</Select>
</template>

<script setup>
import { Select } from 'frappe-ui'

// frappe-ui's OptionIcon hardcodes its color, so disabled rows keep dark icons
// and there is no danger variant for options — style both through the slots.
defineProps({
	options: Array,
	variant: { type: String, default: 'outline' },
})

const iconClass = (option) =>
	option.value === 'remove'
		? 'text-ink-red-6'
		: option.disabled
			? 'text-ink-gray-4'
			: 'text-ink-gray-6'
</script>
