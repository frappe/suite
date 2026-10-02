<template>
	<!-- A thin bar that turns red once storage is nearly full, with the numbers
	     spelled out beneath — or, collapsed, just a whole percent, which is all a
	     sidebar rail has room for. Same rows and gaps either way, so the block
	     keeps its height through a sidebar's width transition. -->
	<div class="flex flex-col gap-2">
		<div class="h-1 w-full rounded-full bg-surface-gray-4">
			<div
				class="h-1 rounded-full"
				:class="usedPercentage > RED_FROM ? 'bg-surface-red-8' : 'bg-surface-gray-10'"
				:style="{ width: `${usedPercentage}%`, maxWidth: '100%' }"
			/>
		</div>
		<!-- leading-4 on both lines, so the label and the min-h'd figure are both
		     16px and the block keeps its height on collapse. The rail leaves a
		     16px column and "100%" needs twice that, so the figure borrows the
		     padding either side to sit centred under the icon; min-h keeps the
		     row when there is no percent to show (unlimited). -->
		<span
			v-if="collapsed"
			class="-mx-2 min-h-4 w-8 text-center text-xs leading-4 tabular-nums"
			:class="usedPercentage > RED_FROM ? 'text-ink-red-6' : 'text-ink-gray-5'"
		>
			{{ limited ? `${Math.round(usedPercentage)}%` : '' }}
		</span>
		<span v-else class="line-clamp-1 text-xs leading-4 text-ink-gray-5">{{ label }}</span>
	</div>
</template>

<script setup lang="ts">
/** Past this the bar, and the figure that stands in for it, read as a warning. */
const RED_FROM = 80

const {
	usedPercentage,
	label,
	limited = true,
	collapsed = false,
} = defineProps<{
	usedPercentage: number
	/** The spelled-out reading, e.g. "5.05% of 10 GB used". */
	label: string
	/** False for storage with no ceiling: the bar stays empty and no percent is shown. */
	limited?: boolean
	/** Narrow form for a collapsed sidebar: the bar, and a rounded percent under it. */
	collapsed?: boolean
}>()
</script>
