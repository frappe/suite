<template>
	<!-- Shared mobile title row (mailbox / all inboxes / screener / profile): 2xl
	     semibold title, optional xs count, optional folder-sheet hamburger or back
	     button, optional search button and the actions slot on the right. Without a leading button the title gets
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
			<!-- 20px at the 1.5 the app draws its icons at: the title's own size, so
			     the glyph and the word beside it stand the same height. Sized by class,
			     not the `size` prop: lucide-vue-next stamps the svg with `lucide-menu`,
			     which frappe-ui's icon plugin also emits as a 1em mask rule, and that
			     rule overrides the prop's width and height — so the icon followed the
			     font size around it, smaller here than in the calendar. A `size-*`
			     utility outranks the rule, and still sizes the svg once it lets svgs go. -->
			<Menu class="size-5" />
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
		<!-- Search sits at the row's far end, in the list views: the hamburger's twin
		     at the other end of the title, the same button at the same size and
		     weight. -->
		<button
			v-if="withSearch"
			:aria-label="__('Search')"
			class="text-ink-gray-6 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
			@click="openSearch"
		>
			<Search class="size-5" />
		</button>
		<slot name="actions" />
	</div>
</template>

<script setup lang="ts">
import { ChevronLeft, Menu, Search } from 'lucide-vue-next'

import { useFolderSheet, useMobileSearch } from '@/apps/mail/utils/composables'

defineProps<{
	title: string
	count?: string
	withMenu?: boolean
	withBack?: boolean
	withSearch?: boolean
}>()

const emit = defineEmits<{ back: [] }>()

const { openFolderSheet } = useFolderSheet()
const { openSearch } = useMobileSearch()
</script>
