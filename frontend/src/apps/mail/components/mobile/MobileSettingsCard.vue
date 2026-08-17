<template>
	<!-- One group of settings rows as a single card: the label sits outside it, and the
	     rows inside are separated by hairlines rather than by gaps, so a group reads as
	     one block instead of a run of loose rows. -->
	<section>
		<div v-if="label" class="text-ink-gray-5 px-1 pb-1.5 text-sm">{{ label }}</div>
		<div class="divide-outline-gray-1 bg-surface-gray-1 divide-y overflow-hidden rounded-6">
			<slot />
		</div>
	</section>
</template>

<script setup lang="ts">
defineProps<{ label?: string }>()
</script>
