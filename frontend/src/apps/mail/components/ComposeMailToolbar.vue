<template>
	<!-- Sticky rather than fixed: fixed positions against the layout viewport, which on iOS still spans
	     the screen with the keyboard up, so the toolbar had to be chased into place with a JS-computed
	     `bottom` — a frame behind every pan, which is what made it judder. Sticking to the bottom of the
	     scroller needs no measuring: the scroller already ends at the keyboard. -->
	<div :class="{ 'bg-surface-base sticky bottom-0 z-20': isMobile }">
		<div
			class="flex flex-wrap justify-between gap-2 overflow-hidden pt-2.5"
			:class="{ 'pb-2.5': isMobile }"
		>
			<!-- Text editor buttons -->
			<!-- frappe-ui's TextEditorMenu pads its own row by 4px and each button by another 4, so
			     left alone the toolbar sits 8px in from the fields and body above it. -ml-1 cancels
			     the row's half: the buttons' boxes then start on the content axis, so the pressed
			     state lines up with the column instead of hanging off it. The glyphs stay 4px in,
			     which is the price of squaring the boxes — -ml-2 buys the reverse. -->
			<div
				class="flex items-center gap-1 overflow-x-auto"
				:class="isMobile ? 'px-3' : '-ml-1'"
			>
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
				<Button variant="ghost" class="max-h-6 max-w-6" @click="fileInput?.click()">
					<template #icon>
						<Paperclip class="icon" />
					</template>
				</Button>
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
				<!-- Split button: one pill, the 1px gap shows the toolbar background as the divider. -->
				<div class="flex items-center gap-px">
					<Button
						variant="solid"
						:label="__('Send')"
						:tooltip="__('Send ({0}+Enter)', [modifier])"
						:icon-left="SendHorizontal"
						:disabled="isRecipientsEmpty"
						class="!rounded-r-none"
						@click="emit('sendMail')"
					/>
					<Dropdown :options="sendOptions" placement="top-end">
						<Button
							variant="solid"
							:tooltip="__('Schedule send')"
							:disabled="isRecipientsEmpty"
							class="!rounded-l-none"
						>
							<template #icon>
								<ChevronDown class="h-4 w-4" />
							</template>
						</Button>
					</Dropdown>
				</div>
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { CalendarClock, ChevronDown, Laugh, Paperclip, SendHorizontal, Trash2 } from 'lucide-vue-next'
import { Button, Dropdown, TextEditorFixedMenu } from 'frappe-ui'

import { isMac } from '@/apps/mail/utils'
import { useScreenSize, useTextEditorButtons } from '@/apps/mail/utils/composables'
import EmojiPicker from '@/apps/mail/components/EmojiPicker.vue'

const { isRecipientsEmpty } = defineProps<{
	isRecipientsEmpty: boolean
}>()

const emit = defineEmits(['appendEmoji', 'selectFiles', 'discardMail', 'sendMail', 'scheduleSend'])

const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

const sendOptions = [
	{
		label: __('Schedule send'),
		icon: CalendarClock,
		onClick: () => emit('scheduleSend'),
	},
]

const { isMobile } = useScreenSize()
const { buttons } = useTextEditorButtons(() => true)

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
