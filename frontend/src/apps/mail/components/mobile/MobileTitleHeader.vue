<template>
	<!-- Shared mobile title row (mailbox / all inboxes / screener / profile): 2xl
	     semibold title, optional xs count, optional folder-sheet hamburger or back
	     button, actions slot on the right. Without a leading button the title gets
	     pl-4 (4px row + 16px = 20px) to sit on the px-5 axis of the list content
	     below it; with one, the button's own inset provides the offset. -->
	<!-- A flat h-14 (56px), not a min-height and no vertical padding: the row is the same
	     height in every view and `items-center` centres against the whole of it. Anything
	     taller than 56px in the actions slot would overflow rather than grow the row —
	     which is the trade that keeps the four views level. -->
	<div class="flex h-14 items-center gap-1 px-1">
		<button
			v-if="withMenu"
			:aria-label="__('Folders')"
			class="text-ink-gray-6 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
			@click="openFolderSheet"
		>
			<Menu :size="18" />
		</button>
		<button
			v-else-if="withBack"
			:aria-label="__('Back')"
			class="text-ink-gray-6 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
			@click="emit('back')"
		>
			<ChevronLeft :size="18" />
		</button>
		<div
			class="flex min-w-0 flex-1 items-baseline gap-2"
			:class="{ 'pl-4': !withMenu && !withBack }"
		>
			<span class="truncate text-xl !font-semibold tracking-[-0.01em]">{{ title }}</span>
			<span v-if="count" class="text-ink-gray-5 shrink-0 text-xs !font-medium">{{ count }}</span>
		</div>
		<slot name="actions" />
	</div>
</template>

<script setup lang="ts">
import { ChevronLeft, Menu } from 'lucide-vue-next'

import { useFolderSheet } from '@/apps/mail/utils/composables'

defineProps<{
	title: string
	count?: string
	withMenu?: boolean
	withBack?: boolean
}>()

const emit = defineEmits<{ back: [] }>()

const { openFolderSheet } = useFolderSheet()
</script>
