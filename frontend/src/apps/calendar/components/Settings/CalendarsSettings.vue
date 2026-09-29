<template>
	<AppSettingsHeader :title="__('Calendars')">
		<template #actions>
			<Button
				icon-left="lucide-plus"
				:label="__('New')"
				:size="isMobile ? 'md' : 'sm'"
				@click="create"
			/>
		</template>
	</AppSettingsHeader>
	<AppSettingsBody>
		<div v-if="calendars.data?.length">
			<div
				v-for="calendar in calendars.data"
				:key="calendar.name"
				class="-mx-2 flex items-center justify-between gap-3 rounded-4 px-3 py-1 max-sm:-mx-4 max-sm:px-4 max-sm:py-2"
				:class="canEdit(calendar) && 'cursor-pointer hover:bg-surface-gray-1'"
				@click="canEdit(calendar) && edit(calendar)"
			>
				<div class="flex min-w-0 items-center gap-2 max-sm:gap-3">
					<span
						class="size-2.5 shrink-0 rounded-full"
						:style="{ background: eventColor(calendarColor(calendars.data, calendar.name)) }"
					/>
					<span class="truncate text-base text-ink-gray-8">{{ calendar._name }}</span>
				</div>
				<div class="flex shrink-0 items-center gap-3 max-sm:-mr-1.5">
					<Badge v-if="calendar.default" :label="__('Default')" />
					<Badge v-if="!canEdit(calendar)" :label="__('Read-only')" />
					<!-- .stop on the wrapper, as mail's folder list has it: the phone's sheet opens
					     on the click bubbling to AdaptiveDropdown's own span. Invisible rather than
					     gone with nothing to offer, so the row keeps the button's height. -->
					<div class="flex" :class="!hasMenuOptions(calendar) && 'invisible'" @click.stop>
						<AdaptiveDropdown :options="menuOptions(calendar)" :title="calendar._name">
							<Button variant="ghost" :aria-label="__('Calendar options')">
								<template #icon>
									<Ellipsis class="size-4 text-ink-gray-5" />
								</template>
							</Button>
						</AdaptiveDropdown>
					</div>
				</div>
			</div>
		</div>

		<CalendarModal v-model="showEdit" :calendar="selected" />
		<DeleteCalendarModal v-model="showDelete" :calendar="selected" />
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { Ellipsis } from 'lucide-vue-next'
import { Badge, Button } from 'frappe-ui'

import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import { useScreenSize } from '@/composables/useScreenSize'

import CalendarModal from '@/apps/calendar/components/Modals/CalendarModal.vue'
import DeleteCalendarModal from '@/apps/calendar/components/Modals/DeleteCalendarModal.vue'
import { useCalendarActions } from '@/apps/calendar/composables/useCalendarActions'
import { userStore } from '@/apps/calendar/stores/user'
import { calendarColor } from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'

const { calendars } = userStore()
const { isMobile } = useScreenSize()
const { selected, showEdit, showDelete, create, edit, canEdit, menuOptions, hasMenuOptions } =
	useCalendarActions()
</script>
