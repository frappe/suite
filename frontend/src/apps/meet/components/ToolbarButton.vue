<script setup lang="ts">
defineOptions({
	inheritAttrs: false,
});

withDefaults(
	defineProps<{
		variant?: "default" | "active";
		active?: boolean;
		title?: string;
		testId?: string;
	}>(),
	{
		variant: "default",
		active: false,
	},
);

defineEmits<{
	click: [];
}>();
</script>

<template>
	<button
		v-bind="$attrs"
		:title="title"
		:data-testid="testId"
		class="relative flex h-11 w-11 items-center justify-center rounded-[12px] bg-white/10 p-0 backdrop-blur-[10px] transition-all duration-200 [&_svg]:text-ink-gray-9 hover:bg-white/15"
		:class="[
			active ? 'bg-white/20 hover:!bg-white/20' : '',
			variant === 'active' ? '[&_svg]:!text-red-500' : '',
		]"
		@click="$emit('click')"
	>
		<slot />
	</button>
</template>
