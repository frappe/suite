<template>
	<Avatar
		v-bind="$attrs"
		:image="image || undefined"
		:label="label"
		:size="size"
		:shape="shape"
		:theme="getAvatarTheme(label)"
	>
		<template v-if="$slots.default"><slot /></template>
		<template v-if="$slots.indicator" #indicator><slot name="indicator" /></template>
	</Avatar>
</template>

<script setup lang="ts">
import { Avatar } from "frappe-ui";
import { getAvatarTheme } from "../utils/avatarTheme";

defineOptions({ inheritAttrs: false });

defineProps<{
	image?: string | null;
	label?: string;
	size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
	shape?: "circle" | "square";
}>();
</script>
