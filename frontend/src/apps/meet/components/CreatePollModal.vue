<template>
    <Dialog v-model="isOpen" title="Create a Poll">
        <template #default>
            <div class="space-y-4">
                <div>
                    <FormControl
                        type="textarea"
                        v-model="question"
                        placeholder="Ask your audience something..."
                        required
                        label="Question"
                    />
                </div>

                <div class="space-y-2">
                    <label class="block text-sm font-medium text-ink-gray-7 mb-1">Options</label>
                    <div 
                        v-for="(option, index) in options" 
                        :key="index" 
                        class="flex items-center gap-2"
                    >
                        <FormControl
                            type="text"
                            v-model="option.text"
                            :placeholder="`Option ${index + 1}`"
                            class="flex-1"
                        />
                        <Button
                            v-if="options.length > 2"
                            variant="ghost"
                            @click="removeOption(index)"
                            class="text-ink-gray-4 hover:text-ink-gray-7 shrink-0"
                        >
                            <lucide-x class="w-4 h-4" />
                        </Button>
                    </div>
                    <div class="flex justify-start">
                        <Button
                            v-if="options.length < 10"
                            variant="subtle"
                            @click="addOption"
                            icon-left="lucide-plus"
                        >
                            Add Option
                        </Button>
                    </div>
                </div>

                <div class="rounded-md border border-outline-gray-2 bg-surface-gray-1 p-4 text-sm flex gap-4">
                    <lucide-alert-triangle class="h-5 w-5 text-ink-gray-6"/>
                    <span class="text-ink-gray-8">
                        Polls are temporary and will be deleted once everyone leaves the meeting.
                    </span>
                </div>
            </div>
        </template>

        <template #actions>
            <div class="flex justify-end gap-2 w-full">
                <Button variant="subtle" @click="closeModal">
                    Cancel
                </Button>
                <Button 
                    variant="solid" 
                    :disabled="!isValid" 
                    @click="handleSubmit"
                >
                    Create Poll
                </Button>
            </div>
        </template>
    </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from "frappe-ui";
import { computed, ref, watch } from "vue";

const props = defineProps<{
	modelValue: boolean;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: boolean];
	submit: [payload: { question: string; options: { text: string }[] }];
}>();

// --- Local State ---
const isOpen = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const question = ref("");
const options = ref([{ text: "" }, { text: "" }]);

const isValid = computed(() => {
	if (!question.value.trim()) return false;

	const validOptions = options.value.filter((opt) => opt.text.trim() !== "");
	return validOptions.length >= 2;
});

// --- Methods ---
const addOption = () => {
	options.value.push({ text: "" });
};

const removeOption = (index: number) => {
	options.value.splice(index, 1);
};

const closeModal = () => {
	isOpen.value = false;
};

const handleSubmit = () => {
	if (!isValid.value) return;

	const cleanedOptions = options.value
		.filter((opt) => opt.text.trim() !== "")
		.map((opt) => ({ text: opt.text.trim() }));

	emit("submit", {
		question: question.value.trim(),
		options: cleanedOptions,
	});

	closeModal();
};

watch(isOpen, (newVal) => {
	if (newVal) {
		question.value = "";
		options.value = [{ text: "" }, { text: "" }];
	}
});
</script>
