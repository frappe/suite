<template>
	<div class="flex items-center justify-between gap-2 border-b px-3 py-2 sm:px-5">
		<!-- undoStatus is the filter everyone reaches for, so it lives in the bar; the
		precise ones (identity, ids, date window) wait behind the Filter button. -->
		<TabButtons v-model="filters.undoStatus" :options="STATUS_TABS" />

		<Popover side="bottom" align="end">
			<template #trigger>
				<Button :label="__('Filter')">
					<template #prefix><ListFilter class="h-4 w-4" /></template>
					<template v-if="activeCount" #suffix>
						<Badge :label="String(activeCount)" theme="gray" />
					</template>
				</Button>
			</template>
			<template #default>
				<div class="flex w-72 flex-col gap-3 p-4">
					<FormControl
						v-model="filters.identityId"
						type="select"
						:label="__('Identity')"
						:options="identityOptions"
					/>
					<FormControl v-model="filters.emailId" :label="__('Email ID')" />
					<FormControl v-model="filters.threadId" :label="__('Thread ID')" />
					<div class="grid grid-cols-2 gap-2">
						<FormControl v-model="filters.after" type="date" :label="__('After')" />
						<FormControl v-model="filters.before" type="date" :label="__('Before')" />
					</div>
					<Button
						v-if="activeCount"
						class="self-end"
						variant="ghost"
						:label="__('Clear filters')"
						@click="clear"
					/>
				</div>
			</template>
		</Popover>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ListFilter } from 'lucide-vue-next'
import { Badge, Button, FormControl, Popover, TabButtons } from 'frappe-ui'

import { userStore } from '@/apps/mail/stores/user'
import {
	activeSubmissionFilterCount,
	emptySubmissionFilters,
	type SubmissionFilters,
} from '@/apps/mail/utils/submission'

// The parent owns the reactive filters object (its list resource reads it and reloads on
// change); this component only writes into it.
const { filters } = defineProps<{ filters: SubmissionFilters }>()

const store = userStore()

const STATUS_TABS = [
	{ label: __('Pending'), value: 'pending' },
	{ label: __('Final'), value: 'final' },
	{ label: __('Cancelled'), value: 'canceled' },
]

const identityOptions = computed(() => [
	{ label: __('All identities'), value: '' },
	...((store.identities.data || []) as { id: string; email: string }[]).map((identity) => ({
		label: identity.email,
		value: identity.id,
	})),
])

// Only the popover's filters count toward the badge — the status tabs show their own state.
const activeCount = computed(() => activeSubmissionFilterCount(filters))

const clear = () =>
	Object.assign(filters, { ...emptySubmissionFilters(), undoStatus: filters.undoStatus })
</script>
