<template>
	<!-- What is narrowed, as badges, under the query line of the palette and the phone's page
	     alike. The whole badge is the way back to the field that set it: the panel opens with
	     that field already open. The pill itself takes the press, so the hover ground is the
	     shape the reader is pointing at rather than the words inside it — the ✕ stops the press
	     from reaching here and removes instead.

	     A <span> rather than a <button>, for the reason mail's badge gives: a button brings its
	     own box and centres what is in it, which laid the label out unlike the plain text beside
	     it and clipped its first letter. -->
	<div
		v-if="badges.length"
		class="relative flex shrink-0 flex-wrap items-center gap-1.5 py-2"
		:class="clearAsWord ? 'px-5' : 'px-4 pr-12'"
	>
		<span
			v-for="badge in badges"
			:key="badge.key"
			class="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-4 bg-surface-gray-2 pl-2 pr-1 text-xs hover:bg-surface-gray-3"
			role="button"
			tabindex="0"
			:aria-label="`Edit ${badge.label}`"
			@mousedown.prevent
			@click="emit('edit', badge.key)"
			@keydown.enter.space.prevent="emit('edit', badge.key)"
		>
			<Tooltip :text="`Click to edit ${badge.label}`">
				<span class="max-w-48 truncate text-ink-gray-7">{{ badge.label }}: {{ badge.value }}</span>
			</Tooltip>
			<button
				class="rounded-4 p-1 text-ink-gray-5 hover:text-ink-gray-8"
				:aria-label="__('Remove filter')"
				@mousedown.prevent
				@click.stop="emit('remove', badge.key)"
			>
				<span class="lucide-x size-3" aria-hidden="true" />
			</button>
		</span>
		<!-- Clear-all: a word on the phone, in the row after the last chip, where there is no
		     tooltip to say what an × does and chips wrap, so a corner is on one of their lines
		     or none. In the palette, the × pinned to the corner that mail's own row pins it to. -->
		<Button
			variant="ghost"
			size="sm"
			:icon="clearAsWord ? undefined : 'lucide-x'"
			:label="clearAsWord ? __('Clear') : undefined"
			:class="clearAsWord ? '-ml-0.5' : 'absolute right-4 top-2 !size-7 !p-0'"
			:aria-label="__('Clear all filters')"
			:tooltip="clearAsWord ? undefined : __('Clear filters')"
			@mousedown.prevent
			@click="emit('clear')"
		/>
	</div>
</template>

<script setup lang="ts">
import { Button, Tooltip } from 'frappe-ui'

import type { CalendarFilterBadge, CalendarSearchFilter } from '@/apps/calendar/composables/useCalendarSearchFilters'

defineProps<{
	badges: CalendarFilterBadge[]
	/** The phone's page: clear-all as a word after the chips rather than an × in the corner. */
	clearAsWord?: boolean
}>()

const emit = defineEmits<{
	edit: [keyof CalendarSearchFilter]
	remove: [keyof CalendarSearchFilter]
	clear: []
}>()
</script>
