<script setup lang="ts">
import { Button } from "frappe-ui";

defineOptions({
	inheritAttrs: false,
});

withDefaults(
	defineProps<{
		variant?: "default" | "active" | "muted";
		active?: boolean;
		title?: string;
		showTooltip?: boolean;
	}>(),
	{
		variant: "default",
		active: false,
		showTooltip: true,
	},
);

defineEmits<{
	click: [];
}>();
</script>

<template>
	<Button
		v-bind="$attrs"
		size="lg"
		variant="ghost"
		theme="gray"
		:label="title"
		:tooltip="showTooltip ? title : undefined"
		:class="[
			'relative',
			{
				'!bg-surface-gray-3': active,
			},
		]"
		@click="$emit('click')"
	>
		<template #icon>
			<span
				:class="{
					'text-ink-red-7': variant === 'active' || variant === 'muted',
				}"
			>
				<slot />
			</span>
		</template>
	</Button>
</template>
