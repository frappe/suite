<template>
	<Popover side="top" align="center" :offset="12" @close="reset">
		<template #trigger="{ open }">
			<div>
				<Tooltip text="YouTube" :hover-delay="0.7">
					<div :class="triggerClass(open)">
						<Youtube class="size-4 stroke-[1.5] text-ink-gray-7" />
					</div>
				</Tooltip>
			</div>
		</template>
		<template #default="{ close }">
			<form class="flex w-72 flex-col gap-2 p-3" @submit.prevent="submit(close)">
				<span class="text-sm text-ink-gray-6">Paste a YouTube video link</span>
				<TextInput v-model="url" type="text" placeholder="https://www.youtube.com/watch?v=…" />
				<span v-if="hasError" class="text-sm text-ink-red-4">
					Couldn't find a video at that link
				</span>
				<Button variant="solid" label="Insert" :disabled="!url" @click="submit(close)" />
			</form>
		</template>
	</Popover>
</template>

<script setup>
import { ref } from 'vue'

import { Youtube } from 'lucide-vue-next'
import { Popover, Tooltip, TextInput, Button } from 'frappe-ui'

import { addYoutubeElement } from '@/apps/slides/stores/element'

const url = ref('')
const hasError = ref(false)

const triggerClass = (isOpen) => [
	'flex cursor-pointer items-center rounded-4 p-2 hover:bg-surface-gray-3',
	{ 'bg-surface-gray-3': isOpen },
]

const reset = () => {
	url.value = ''
	hasError.value = false
}

const submit = (close) => {
	if (!addYoutubeElement(url.value)) {
		hasError.value = true
		return
	}
	close()
}
</script>
