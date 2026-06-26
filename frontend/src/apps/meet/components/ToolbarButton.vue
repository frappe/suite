<script setup lang="ts">
import { Tooltip } from "frappe-ui";

defineOptions({
	inheritAttrs: false,
});

withDefaults(
	defineProps<{
		variant?: "default" | "active" | "muted";
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
	<Tooltip :text="title" :disabled="!title" :hover-delay="0.3">
		<button
			v-bind="$attrs"
			:data-testid="testId"
			class="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-transparent p-0 transition-all duration-200 [&_svg]:h-6 [&_svg]:w-6 [&_svg]:text-ink-gray-9 hover:bg-white/10"
			:class="[
				active ? 'bg-white/10 hover:!bg-white/10' : '',
				variant === 'active' ? '[&_svg]:!text-red-500' : '',
				variant === 'muted' ? '[&_svg]:!text-[#E54E17]' : '',
			]"
			@click="$emit('click')"
		>
			<slot />
		</button>
	</Tooltip>
</template>
