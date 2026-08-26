<template>
	<div class="block pt-2 text-sm">
		<span class="text-ink-gray-6 mb-2 block leading-4">{{ label }}</span>
		<button
			class="bg-surface-gray-2 flex w-full items-center rounded-6 border-2 p-1"
			@click="copyToClipBoard(value)"
		>
			<span class="scrollbar-none text-ink-gray-7 mr-1.5 overflow-x-scroll text-nowrap">
				{{ value }}
			</span>
			<span class="bg-surface-base text-ink-gray-5 ml-auto rounded-4 border p-1 text-xs">
				{{ message }}
			</span>
		</button>
	</div>
</template>
<script setup lang="ts">
import { ref } from 'vue'

const message = ref('Copy')

defineProps<{ label: string; value: string }>()

const copyToClipBoard = async (text: string) => {
	try {
		await navigator.clipboard.writeText(text)
		message.value = 'Copied!'
		setTimeout(() => (message.value = 'Copy'), 2000)
	} catch {
		alert('Failed to copy text. Please copy from here: ' + text)
	}
}
</script>

<style>
.scrollbar-none::-webkit-scrollbar {
	display: none;
}

.scrollbar-none {
	-ms-overflow-style: none;
	scrollbar-width: none;
}
</style>
