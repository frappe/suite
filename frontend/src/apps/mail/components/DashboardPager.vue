<template>
	<!-- The desk list view's footer: how many rows are shown, the page length, and Load More.
	     The list above it fills the body and scrolls on its own, so this always sits at the
	     bottom of the screen; the negative margin swallows the body's bottom padding. -->
	<div
		class="text-ink-gray-5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t text-sm"
		:class="flush ? '-mb-5 px-1 pb-4 pt-2' : 'px-5 py-2'"
	>
		<span>{{ __('{0} of {1}', [String(count), String(total)]) }}</span>
		<div class="flex items-center gap-3">
			<div class="flex items-center gap-1">
				<Button
					v-for="length in PAGE_LENGTHS"
					:key="length"
					size="sm"
					:variant="length === pageLength ? 'subtle' : 'ghost'"
					:label="String(length)"
					@click="emit('update:pageLength', length)"
				/>
			</div>
			<Button v-if="hasMore" size="sm" :label="__('Load More')" :loading="loading" @click="emit('loadMore')" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

import { PAGE_LENGTHS, type PageLength } from '@/apps/mail/utils/pagedList'

const { flush = true } = defineProps<{
	count: number
	total: number
	pageLength: PageLength
	hasMore: boolean
	loading?: boolean
	// At the bottom of a page the footer sits flush against the edge; inside a card it does not.
	flush?: boolean
}>()
const emit = defineEmits<{ 'update:pageLength': [value: PageLength]; loadMore: [] }>()
</script>
