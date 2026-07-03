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
	<Button
		v-bind="$attrs"
		size="lg"
		variant="ghost"
		theme="gray"
		:data-testid="testId"
		:tooltip="title"
		:class="['relative', { '!bg-surface-gray-3': active }]"
		@click="$emit('click')"
	>
		<template #icon>
			<span
				:class="{
					'text-ink-red-8': variant === 'active' || variant === 'muted',
				}"
			>
				<slot />
			</span>
		</template>
	</Button>
</template>
