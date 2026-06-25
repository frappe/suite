<script setup lang="ts">
defineProps<{
	label: string;
}>();

defineEmits<{
	click: [];
}>();
</script>

<template>
	<button
		class="group flex flex-col items-center gap-2.5 rounded-2xl border border-outline-gray-1 bg-surface-gray-1 p-1.5 transition-colors hover:bg-surface-gray-2"
		@click="$emit('click')"
	>
		<div
			class="flex h-[100px] w-full items-center justify-center rounded-[14px] border border-outline-gray-1 bg-surface-base"
		>
			<div
				class="flex h-11 w-11 items-center justify-center rounded-[30px] bg-surface-base text-ink-gray-8 transition-transform group-hover:scale-105"
			>
				<slot name="icon" />
			</div>
		</div>
		<span
			class="text-sm-medium w-full truncate text-center text-ink-gray-8 tracking-[0.21px]"
		>
			{{ label }}
		</span>
	</button>
</template>
