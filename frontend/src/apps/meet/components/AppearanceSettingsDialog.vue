<template>
	<Dialog v-model="show" :options="{ title: 'Appearance' }">
		<template #body-content>
			<div class="space-y-4">
				<div class="space-y-2">
					<label class="text-sm-medium text-ink-gray-8">Theme</label>
					<FormControl
						v-model="colorScheme"
						type="select"
						variant="outline"
						:options="COLOR_SCHEMES"
						data-testid="appearance-theme-select"
					/>
					<p class="text-xs text-ink-gray-6">
						Choose how Frappe Meet looks to you.
					</p>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
	modelValue?: boolean;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: boolean];
}>();

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const COLOR_SCHEMES = [
	{ label: "System Default", value: "system" },
	{ label: "Light", value: "light" },
	{ label: "Dark", value: "dark" },
];

const colorScheme = ref("system");

const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

function resolveTheme(value: string): "light" | "dark" {
	if (value === "system") return mediaQuery.matches ? "dark" : "light";
	return value as "light" | "dark";
}

function applyTheme(value: string) {
	const theme = resolveTheme(value);
	document.documentElement.setAttribute("data-theme", theme);
}

watch(colorScheme, (value) => {
	localStorage.setItem("meet-color-scheme", value);
	applyTheme(value);
});

function onMediaChange() {
	if (colorScheme.value === "system") applyTheme("system");
}

onMounted(() => {
	const stored = localStorage.getItem("meet-color-scheme");
	if (stored) {
		colorScheme.value = stored;
	}
	applyTheme(colorScheme.value);
	mediaQuery.addEventListener("change", onMediaChange);
});

onUnmounted(() => {
	mediaQuery.removeEventListener("change", onMediaChange);
});
</script>
