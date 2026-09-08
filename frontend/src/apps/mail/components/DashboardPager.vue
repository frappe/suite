<template>
	<!-- The desk list view's footer: how many rows are shown, the page length, and Load More. -->
	<div class="text-ink-gray-5 flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm">
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

defineProps<{
	count: number
	total: number
	pageLength: PageLength
	hasMore: boolean
	loading?: boolean
}>()
const emit = defineEmits<{ 'update:pageLength': [value: PageLength]; loadMore: [] }>()
</script>
