<template>
	<Dialog v-model:open="open" title="Stop recording?" size="sm">
		<template #default>
			<p class="text-base text-ink-gray-7">
				The recording will stop and the video will be saved privately to the room owner's Drive.
			</p>
		</template>
		<template #actions>
			<div class="flex w-full justify-end gap-2">
				<Button variant="subtle" :disabled="loading" @click="open = false">Cancel</Button>
				<Button
					variant="solid"
					theme="red"
					icon-left="lucide-circle-stop"
					label="Stop recording"
					:loading="loading"
					@click="emit('confirm')"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog } from "frappe-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<{ modelValue?: boolean; loading?: boolean }>(), {
	modelValue: false,
	loading: false,
});
const emit = defineEmits<{ "update:modelValue": [value: boolean]; confirm: [] }>();
const open = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});
</script>
