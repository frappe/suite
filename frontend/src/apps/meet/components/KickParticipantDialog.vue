<template>
	<Dialog
		v-model:open="showDialog"
		title="Remove Participant"
		size="sm"
	>
		<template #default>
			<div class="space-y-4">
				<p class="text-base text-ink-gray-7">
					Are you sure you want to remove <strong>{{ participantName }}</strong> from the meeting?
				</p>
				<FormControl
					v-if="canBan"
					label="Ban from this meeting?"
					type="checkbox"
					v-model="banFromMeeting"
				/>
			</div>
		</template>
		<template #actions>
			<div class="flex justify-end gap-2 w-full">
				<Button variant="subtle" @click="showDialog = false">Cancel</Button>
				<Button variant="solid" theme="red" @click="handleKickConfirm">Remove</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from "frappe-ui";
import { computed, ref, watch } from "vue";

interface Props {
	participantName: string;
	modelValue?: boolean;
	canBan?: boolean;
}

interface Emits {
	(e: "update:modelValue", value: boolean): void;
	(e: "confirm", ban: boolean): void;
}

const props = withDefaults(defineProps<Props>(), {
	modelValue: false,
	canBan: false,
});

const emit = defineEmits<Emits>();

const banFromMeeting = ref(false);

const showDialog = computed({
	get: () => props.modelValue,
	set: (value: boolean) => {
		if (!value) banFromMeeting.value = false;
		emit("update:modelValue", value);
	},
});

watch(
	() => props.modelValue,
	(open) => {
		if (!open) banFromMeeting.value = false;
	},
);

const handleKickConfirm = () => {
	emit("confirm", banFromMeeting.value);
	banFromMeeting.value = false;
	showDialog.value = false;
};
</script>
