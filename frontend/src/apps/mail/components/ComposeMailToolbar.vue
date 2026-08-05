<template>
	<div :class="{ 'fixed left-0 right-0 z-20': isMobile }" :style="{ bottom: toolbarBottom }">
		<div
			class="flex flex-wrap justify-between gap-2 overflow-hidden pt-2.5"
			:class="{ 'pb-2.5': isMobile }"
		>
			<!-- Text editor buttons -->
			<div class="flex items-center gap-1 overflow-x-auto" :class="{ 'px-3': isMobile }">
				<TextEditorFixedMenu :buttons class="!bg-inherit" />
				<EmojiPicker
					v-if="!isMobile"
					v-slot="{ togglePopover }"
					@update:model-value="emit('appendEmoji', $event)"
				>
					<Button variant="ghost" class="max-h-6 max-w-6" @click="togglePopover()">
						<template #icon>
							<Laugh class="icon" />
						</template>
					</Button>
				</EmojiPicker>
				<Dropdown :options="attachOptions">
					<Button variant="ghost" class="max-h-6 max-w-6">
						<template #icon>
							<Paperclip class="icon" />
						</template>
					</Button>
				</Dropdown>
				<input
					ref="fileInput"
					type="file"
					class="hidden"
					multiple
					@change="onFilesSelected"
				/>
			</div>

			<!-- Send & Discard -->
			<div v-if="!isMobile" class="ml-auto flex items-center space-x-2">
				<Button
					:label="__('Discard')"
					:tooltip="__('Discard ({0}+D)', [modifier])"
					:icon-left="Trash2"
					@click="emit('discardMail')"
				/>
				<Button
					variant="solid"
					:label="__('Send')"
					:tooltip="__('Send ({0}+Enter)', [modifier])"
					:icon-left="SendHorizontal"
					:disabled="isRecipientsEmpty"
					@click="emit('sendMail')"
				/>
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { HardDrive, Laugh, Monitor, Paperclip, SendHorizontal, Trash2 } from 'lucide-vue-next'
import { Button, Dropdown, TextEditorFixedMenu } from 'frappe-ui'

import { isMac } from '@/apps/mail/utils'
import { useScreenSize, useTextEditorButtons, useVisualViewport } from '@/apps/mail/utils/composables'
import EmojiPicker from '@/apps/mail/components/EmojiPicker.vue'

const { isRecipientsEmpty } = defineProps<{
	isRecipientsEmpty: boolean
}>()

const emit = defineEmits(['appendEmoji', 'selectFiles', 'attachFromDrive', 'discardMail', 'sendMail'])

const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

const attachOptions = [
	{
		label: __('Upload from computer'),
		icon: Monitor,
		onClick: () => fileInput.value?.click(),
	},
	{
		label: __('Attach from Frappe Drive'),
		icon: HardDrive,
		onClick: () => emit('attachFromDrive'),
	},
]

// Make toolbar hover over keyboard on mobile

const { isMobile } = useScreenSize()
const { buttons } = useTextEditorButtons()

const toolbarBottom = useVisualViewport(
	(viewport) => `${window.innerHeight - viewport.height - viewport.offsetTop}px`,
)

const fileInput = useTemplateRef('fileInput')

const onFilesSelected = async (e: Event) => {
	const input = e.target as HTMLInputElement
	const files = Array.from(input.files ?? [])
	if (!files.length) return

	emit('selectFiles', files)
	input.value = ''
}
</script>

<!-- todo: file upload -> discard race condition (draft saved) -->
