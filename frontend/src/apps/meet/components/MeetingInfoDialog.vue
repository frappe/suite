<template>
	<Dialog v-model="show" :options="{ title: 'Meeting Information' }">
		<template #body-content>
			<div class="space-y-4">
				<div class="space-y-2">
					<label class="text-sm-medium text-gray-700">Meeting ID</label>
					<ClickToCopyField :textContent="meetingId" :breakLines="false" />
				</div>

				<div class="space-y-2">
					<label class="text-sm-medium text-gray-700">Meeting URL</label>
					<ClickToCopyField :textContent="meetingUrl" :breakLines="false" />
				</div>

			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Dialog } from "frappe-ui";
import { computed } from "vue";
import ClickToCopyField from "./ClickToCopyField.vue";

const props = defineProps<{
	modelValue?: boolean;
	meetingId: string;
	meetingTitle?: string;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: boolean];
}>();

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const meetingUrl = computed(() => window.location.href);
</script>
