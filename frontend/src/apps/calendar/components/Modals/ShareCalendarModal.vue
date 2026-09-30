<template>
	<Dialog
		v-model:open="show"
		:title="__('Share {0}', [calendar?._name])"
	>
		<template #default>
			<div class="space-y-4">
				<p v-if="!mayShare" class="text-p-base text-ink-gray-6">
					{{ __("Only this calendar's owner can change who sees it.") }}
				</p>

				<Combobox
					v-else
					ref="picker"
					v-model:open="showMatches"
					class="w-full"
					:options="options"
					:filterable="false"
					:placeholder="__('Add a person or group')"
					@update:query="onQuery"
					@update:model-value="add"
				>
					<template #item-prefix="{ item }">
						<Avatar :label="item.label" size="md" />
					</template>
				</Combobox>

				<!-- One grant, said once rather than on every row: what a reader gets is the whole
				     calendar, and a row marked Custom is the exception, explained on the mark. -->
				<p v-if="sharees.length" class="text-p-sm text-ink-gray-5">
					{{ __('Everyone here can see every event on this calendar.') }}
				</p>
				<div v-if="sharees.length" class="space-y-3">
					<div v-for="sharee in sharees" :key="sharee.principal_id" class="flex items-center gap-2">
						<Avatar :label="shareeName(sharee)" size="lg" />
						<span class="flex min-w-0 flex-1 flex-col space-y-0.5">
							<span class="truncate text-sm-medium text-ink-gray-8">{{ shareeName(sharee) }}</span>
							<span v-if="sharee.email" class="truncate text-p-sm text-ink-gray-5">
								{{ sharee.email }}
							</span>
						</span>

						<!-- Rights no role here describes: shown so the list is the whole truth, and left
						     alone — this dialog has no word for them, so it is in no position to rewrite
						     or drop them. -->
						<Tooltip
							v-if="!sharee.role"
							:text="__('Set outside this app. Change it wherever it was granted.')"
						>
							<Badge :label="__('Custom')" />
						</Tooltip>
						<Button
							v-else
							variant="ghost"
							:aria-label="__('Remove {0}', [shareeName(sharee)])"
							:disabled="!mayShare"
							@click="remove(sharee.principal_id)"
						>
							<template #icon>
								<X class="size-4 text-ink-gray-5" />
							</template>
						</Button>
					</div>
				</div>
				<p v-else-if="mayShare" class="text-p-base text-ink-gray-5">
					{{ __('This calendar is yours alone.') }}
				</p>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { Avatar, Badge, Button, Combobox, Dialog, Tooltip, createResource } from 'frappe-ui'

import { toastError } from '@/apps/calendar/utils'
import { usePeopleSearch } from '@/apps/calendar/composables/usePeopleSearch'
import { isShared, managedSharees, shareeName } from '@/apps/calendar/utils/sharing'

import type { CalendarRow } from '@/apps/calendar/utils/calendars'
import type { Principal, Sharee } from '@/apps/calendar/utils/sharing'

/** A match as the picker lists it. */
type PrincipalOption = Principal & { label: string; value: string }

const show = defineModel<boolean>()

/**
 * The calendar whose audience this is, and the audience as it was loaded on the way here. The
 * loaded audience names its calendar, and that — not the row the dialog was opened from — is
 * what a save goes to: what is shown and where it is saved can never be two calendars.
 */
const { calendar, sharing } = defineProps<{
	calendar?: CalendarRow
	sharing?: { account: string; id: string; may_share: boolean; sharees: Sharee[] }
}>()

// What the server last agreed to, and what the dialog shows. Adding or removing somebody shows
// at once and saves behind — a dialog that waited on the server for each would feel broken —
// and a save that fails puts the list back to the first.
const saved = ref<Sharee[]>([])
const sharees = ref<Sharee[]>([])
const mayShare = ref(false)

const onError = toastError

// Taken from the prop each time it opens, so the dialog shows what was loaded on the way to it
// and never changes after it appears. Copied, since the rows are edited in place.
watch(show, (open) => {
	if (!open) return
	saved.value = sharing?.sharees ?? []
	sharees.value = (sharing?.sharees ?? []).map((sharee) => ({ ...sharee }))
	mayShare.value = !!sharing?.may_share
	query.value = ''
})

const save = createResource({
	url: 'suite.calendar.api.set_calendar_sharing',
	makeParams: () => ({
		account: pending!.account,
		id: pending!.id,
		sharees: managedSharees(pending!.sharees),
	}),
	// No toast on success: the row that appeared or went is the confirmation. What the server
	// agreed to is the list that was sent, not the one shown — which may already hold the next
	// change, waiting its turn — and only if it was sent for the calendar on screen: the dialog
	// may have closed and reopened for another while the request was out.
	onSuccess: () => {
		if (forThisCalendar(pending)) saved.value = pending!.sharees
		flush()
	},
	// The server caps how many a calendar may be shared with and does not say the number, so
	// its refusal is the only account of the limit there is to show. The list goes back to what
	// it last agreed to, and a change of that calendar's waiting its turn goes with it, since it
	// was made on a list the server never held. A refusal for a calendar the dialog has since
	// left is told, and nothing on screen is undone. Whatever else is waiting still goes.
	onError: (error) => {
		if (pending && forThisCalendar(pending)) {
			waiting.delete(keyOf(pending))
			sharees.value = saved.value.map((sharee) => ({ ...sharee }))
		}
		toastError(error)
		flush()
	},
})

// Every save replaces the whole list, so two in flight at once could land in either order and
// the older undo the newer. One goes at a time; a change made while one is out waits, and is
// sent when the first comes back. Each carries the calendar it is for and the list as it stood,
// since the dialog can be closed and reopened — for the same calendar or another — before an
// answer arrives: what waits is never lost to that, and never sent to the wrong calendar.
type Pending = { account: string; id: string; sharees: Sharee[] }
let pending: Pending | null = null
const waiting = new Map<string, Pending>()

const keyOf = (request: Pending) => `${request.account}|${request.id}`

const forThisCalendar = (request: Pending) =>
	request.account === sharing?.account && request.id === sharing?.id

const snapshot = (): Pending => ({
	account: sharing!.account,
	id: sharing!.id,
	sharees: sharees.value.map((sharee) => ({ ...sharee })),
})

const submit = (request: Pending) => {
	pending = request
	save.submit()
}

// A later change to the same calendar replaces an earlier one still waiting: each is the whole
// list, so the latest is the only one worth sending.
const persist = () => {
	const request = snapshot()
	if (save.loading) waiting.set(keyOf(request), request)
	else submit(request)
}

const flush = () => {
	const next = waiting.values().next().value
	if (!next) return
	waiting.delete(keyOf(next))
	submit(next)
}


const {
	query,
	open: showMatches,
	combobox: picker,
	matches,
	onQuery,
	find,
	clear,
} = usePeopleSearch<PrincipalOption>({
	url: 'suite.calendar.api.search_principals',
	makeParams: (text: string) => ({ account: calendar!.account, text }),
	transform: (people: Principal[]) =>
		people.map((person) => ({ ...person, label: shareeName(person), value: person.principal_id })),
})

// Somebody already on the calendar is left out of the matches rather than offered and marked:
// unlike an event's participants, who is already on it is in this same dialog, directly below.
const options = computed(() =>
	matches.value.filter((person) => !isShared(sharees.value, person.principal_id)),
)

const add = async (principalId: string | null) => {
	if (!principalId) return
	const person = find(principalId)
	if (person && !isShared(sharees.value, principalId)) {
		const { label, value, ...principal } = person
		sharees.value = [...sharees.value, { ...principal, role: 'view' }]
		persist()
	}
	await clear()
}

const remove = (principalId: string) => {
	sharees.value = sharees.value.filter((sharee) => sharee.principal_id !== principalId)
	persist()
}
</script>
