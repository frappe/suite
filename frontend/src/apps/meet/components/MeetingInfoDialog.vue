<template>
	<Dialog v-model="show" title="Meeting Information">
		<template #default>
			<div class="space-y-4">
				<div class="space-y-2">
					<label class="text-sm-medium text-ink-gray-8">Meeting ID</label>
					<ClickToCopyField :textContent="meetingId" :breakLines="false" />
				</div>

				<div class="space-y-2">
					<label class="text-sm-medium text-ink-gray-8">Meeting URL</label>
					<ClickToCopyField :textContent="meetingUrl" :breakLines="false" />
				</div>

				<div v-if="e2eeFingerprint" class="space-y-2">
					<label class="text-sm-medium text-ink-gray-8">Encryption fingerprint</label>
					<ClickToCopyField :textContent="e2eeFingerprint" :breakLines="false" />
					<p class="text-xs text-ink-gray-6">
						Everyone in this encrypted meeting should see the same fingerprint.
					</p>
				</div>

			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Dialog } from "frappe-ui";
import { computed } from "vue";
import { useE2EEState } from "../composables/useE2EEState";
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
const { sessionFingerprint: e2eeFingerprint } = useE2EEState();
</script>
