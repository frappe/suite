<template>
	<!-- The tooltip names the fold, since the chevron alone doesn't say which way it goes. It is
	     empty — and so not shown — on the last group, which never folds. -->
	<Tooltip :text="collapsible ? __(collapsed ? 'Expand' : 'Collapse') : ''">
		<div
			class="text-ink-gray-6 group flex items-center border-b border-l-transparent p-3.5 text-xs-semibold sm:border-l sm:px-5"
			:class="{
				'!bg-surface-blue-1': selected,
				'sm:hover:bg-surface-gray-1': collapsible,
				'!border-l-outline-blue-5': focused,
			}"
			:data-row-key="`group:${dateKey}`"
			@click="emit('toggle')"
		>
			<!-- The mailbox list puts its "select the whole day" checkbox here. -->
			<slot name="lead" />

			<span class="select-none pt-0.5">
				{{ getFormattedDate(dateKey, monthly).toUpperCase() }}
			</span>

			<component :is="collapsed ? ChevronRight : ChevronDown" v-if="collapsible" class="icon ml-auto" />
		</div>
	</Tooltip>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { Tooltip } from 'frappe-ui'

import { getFormattedDate } from '@/apps/mail/utils'

/**
 * A date header in a thread list: the day (or month) it covers, a chevron that folds it, and whatever
 * the list wants beside the date.
 *
 * Both lists draw the same header — same classes, same date span, same chevron — and this is the one
 * navigable row neither gets from buildListRows, which is deliberately date-agnostic.
 */

defineProps<{
	/** The group's key: 'YYYY-MM-DD', or 'YYYY-MM' when grouping by month. */
	dateKey: string
	/** Grouping by month rather than by day, which the date is formatted for. */
	monthly: boolean
	/** Currently folded. */
	collapsed: boolean
	/**
	 * Whether this group can fold at all. The last one never can — it is where infinite scroll
	 * appends, so hiding it would swallow newly loaded rows.
	 */
	collapsible: boolean
	/** The keyboard cursor is on this header. */
	focused: boolean
	/** Every thread in the group is selected (the mailbox list's day checkbox). */
	selected?: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>
