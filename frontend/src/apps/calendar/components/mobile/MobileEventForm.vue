<template>
	<!--
	  The event form as a phone screen. The desktop dialog at 390px keeps every affordance
	  and fits none of them: the alert sentence wraps, Availability and Visibility share a
	  row at ~120px each, and Save sits inside the scroll, below the participants. Here each
	  field takes a row of its own and the header always holds Save. Participants follow the
	  time rather than closing the form: who is coming is settled with when it is, and the
	  desktop's own layout says as much — a column beside the details, not below them.
	  Anything that needs a choice — repeat, alert, visibility, participants — opens a sheet
	  or a screen of its own rather than an inline dropdown.

	  Fixed and sized to the *visible* viewport rather than left in flow, for the reasons
	  mail's ComposeView spells out: the suite shell's <main> is itself a scroller and iOS
	  pans the visible area to reveal a focused field, either of which carries a header left
	  in flow off the top of the screen.
	-->
	<div
		class="fixed inset-x-0 z-30 flex flex-col overflow-hidden bg-surface-base"
		:style="{ top: `${keyboardTop}px`, height: `${viewportHeight}px` }"
	>
		<!-- The two screens, each a page: header and body in one box, one shown at a
		     time and the other sliding through. The participants page comes in from
		     the right and goes back out to it; the form goes out to the left and comes
		     back from there — a push both ways, the way the detail sheet turns its
		     pages. The one on its way out is lifted out of the flow so the arriving
		     one has the box from the first frame, and the fixed root clips the pair;
		     see the style block. v-show, not v-if, so the form keeps its scroll
		     position and any field mid-edit while the reader is away. -->
		<template v-for="s in SCREENS" :key="s">
			<Transition :name="s === 'form' ? 'screen-form' : 'screen-participants'">
				<div v-show="screen === s" class="flex min-h-0 flex-1 flex-col">
					<!-- Each screen is a whole page, header and all, so the two slide as pages: the
					     participants come in from the right with their own header and the form goes
					     out to the left with its own. The header is written once and rendered for
					     each screen, so the mark on the left and the title beside it land on the
					     same two pixels either way — two headers with the same numbers written twice
					     is a thing that stays aligned only until one of them is edited.

					     What differs is the mark and what it does. The form is a surface over the
					     calendar and leaving it discards the event, which is a cross; the
					     participants screen is pushed from the form and steps back to it, which is
					     a chevron. Reading the same mark on both would leave no way to tell whether
					     going back returns to the form or throws the whole event away. -->
					<header
						class="flex shrink-0 items-center justify-between gap-2 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.875rem)]"
					>
						<div class="flex min-w-0 items-center gap-1">
							<!-- -ml-1.5, not -ml-2: an icon-only Button is a 32px square with no padding
							     of its own, so its 20px glyph sits 6px in. Pulling the square 6px left
							     of the header's own 16px margin puts the glyph on that margin — the
							     line the cards below it start on. -->
							<!-- Each screen's own element, not one shared and re-labelled. A tap latches
							     :hover onto what it touched until something else is touched, and the ghost
							     Button paints that hover: coming back from the participants screen, a
							     shared ✕ wore the highlight for a tap the reader made on the chevron.
							     Blurring doesn't reach it — it isn't focus. A button that didn't take the
							     tap can't be the one holding it. -->
							<Button
								variant="ghost"
								class="-ml-1.5"
								:aria-label="s === 'form' ? __('Close') : __('Back')"
								@click="leaveScreen"
							>
								<template #icon>
									<X v-if="s === 'form'" class="size-5 text-ink-gray-7" />
									<ChevronLeft v-else class="size-5 text-ink-gray-7" />
								</template>
							</Button>
							<h2 class="truncate text-xl font-medium text-ink-gray-9">
								{{ s === 'form' ? title : __('Participants') }}
							</h2>
						</div>
						<!-- Two words and a button, as the design has it. Keeping a draft is what
						     leaving offers when there is something to keep, and deleting a saved event
						     is the detail sheet's ⋯ — neither needs a menu of its own up here.

						     Nothing on the right of the participants screen: the list is bound with
						     v-model, so it is the event's the moment it changes and there is no commit
						     left to offer. -->
						<Button
							v-if="s === 'form'"
							variant="solid"
							class="!rounded-9 shrink-0"
							:label="__('Save')"
							:disabled="disableSave"
							@click="emit('save')"
						/>
					</header>
					<template v-if="s === 'form'">
						<div class="min-h-0 flex-1 overflow-y-auto pb-10">
							<!-- The title is the one field that isn't a row: it reads as the event's name,
							     the way the desktop dialog's lead title does, and carries the caret on a
							     new event. -->
							<!-- The 16px margin belongs to the wrapper, not to the field: as the field's own
							     padding it left the underline running the full width of the screen while the
							     text sat inset from it, and a rule that reaches further than anything above or
							     below it reads as the edge of a section rather than the bottom of a field. -->
							<div class="mb-3 mt-1 px-4">
								<input
									v-model="event.title"
									:autofocus="isNew"
									:placeholder="__('Add title')"
									class="w-full border-0 border-b border-outline-gray-1 bg-transparent px-0 pb-2.5 pt-2 text-xl font-medium text-ink-gray-9 placeholder:font-normal placeholder:text-ink-gray-3 focus:border-outline-gray-2 focus:ring-0"
								/>
							</div>

							<!-- when -->
							<div :class="GROUP">
								<div :class="ROW">
									<Clock :class="ICON" />
									<span class="flex-1">{{ __('All day') }}</span>
									<Switch
										:model-value="event.isAllDay"
										@update:model-value="(value: boolean) => emit('setAllDay', value)"
									/>
								</div>
								<div :class="ROW">
									<CalendarDays :class="ICON" />
									<span class="flex-1">{{ __('Starts') }}</span>
									<!-- Native date and time inputs: the value opens the platform's own picker,
									     which is the control a phone already has for this and the one the reader
									     knows. The desktop's popover pickers stay on the desktop. -->
									<div :class="[PILL_PAIR, event.isAllDay ? 'w-32' : 'w-54']">
										<input v-model="event.startDate" type="date" :class="[PILL, PILL_DATE]" />
										<input
											v-if="!event.isAllDay"
											v-model="event.startTime"
											type="time"
											:class="[PILL, PILL_TIME]"
										/>
									</div>
								</div>
								<div :class="ROW">
									<!-- The calendar is drawn once for the pair: Starts and Ends are one
									     fact read in two rows, and a second glyph made them two facts that
									     happened to share a group. Same as the alerts below, where only the
									     first of them carries the bell. -->
									<span :class="ICON_BLANK" />
									<span class="flex-1">{{ __('Ends') }}</span>
									<div :class="[PILL_PAIR, event.isAllDay ? 'w-32' : 'w-54']">
										<input v-model="event.endDate" type="date" :class="[PILL, PILL_DATE]" />
										<input
											v-if="!event.isAllDay"
											v-model="event.endTime"
											type="time"
											:class="[PILL, PILL_TIME]"
										/>
									</div>
								</div>
								<button :class="ROW" @click="emit('toggleRepeat')">
									<Repeat :class="ICON" />
									<span class="shrink-0">{{ __('Repeat') }}</span>
									<span :class="VALUE_LONG">{{ repeatValue }}</span>
									<ChevronRight :class="CHEVRON" />
								</button>
							</div>

							<div :class="GROUP">
								<button :class="ROW" @click="screen = 'participants'">
									<Users :class="ICON" />
									<span class="flex-1">{{ __('Participants') }}</span>
									<!-- The ring separates each avatar from the one behind it. An outline
									     colour rather than the row's own background: the background notches
									     them apart where they overlap but is invisible on a single avatar,
									     which is the common case here. `ring-outline-*` is also the only
									     ring colour the preset registers — `ring-surface-gray-1` compiled to
									     nothing and fell through to Tailwind's default ring, which is blue. -->
									<div v-if="participants.length" class="flex items-center pl-2">
										<Avatar
											v-for="participant in participants.slice(0, 3)"
											:key="participant.email"
											:image="participant.user_image"
											:label="participant._name || participant.email"
											size="sm"
											class="-ml-2 ring-1 ring-outline-gray-2 first:ml-0"
										/>
									</div>
									<span :class="VALUE">{{ participants.length }}</span>
									<ChevronRight :class="CHEVRON" />
								</button>
							</div>

							<!-- where — a room and a video call are two answers to the same question, so they
							     are read as one group. -->
							<div ref="locationsEl" :class="GROUP">
								<div :class="ROW">
									<img :src="meetLogo" :alt="__('Frappe Meet')" class="size-4 shrink-0" />
									<template v-if="meetUrl">
										<span class="min-w-0 flex-1 truncate">{{ meetLinkDisplay }}</span>
										<Button :label="__('Join')" size="sm" @click="emit('joinMeet')" />
									</template>
									<template v-else>
										<span class="flex-1">{{ __('Add Frappe Meet video call') }}</span>
										<Switch v-model="event.addMeetLink" />
									</template>
								</div>
								<div v-for="(_, i) in event.locations" :key="i" :class="ROW">
									<MapPin v-if="i === 0" :class="ICON" />
									<span v-else :class="ICON_BLANK" />
									<input
										v-model="event.locations[i]"
										:placeholder="__('Meeting location {0}', [i + 1])"
										class="min-w-0 flex-1 border-0 bg-transparent p-0 text-p-base text-ink-gray-8 placeholder:text-ink-gray-4 focus:ring-0"
									/>
									<button
										class="shrink-0 text-ink-gray-4"
										:aria-label="__('Remove location')"
										@click="event.locations.splice(i, 1)"
									>
										<X class="size-4" />
									</button>
								</div>
								<button v-if="canAddLocation" :class="ROW" @click="addLocation">
									<MapPin v-if="!event.locations.length" :class="ICON" />
									<span v-else :class="ICON_BLANK" />
									<span class="flex-1 text-ink-gray-4">{{ __('Add location') }}</span>
								</button>
							</div>

							<!-- alerts. Each reads as a phrase and opens a sheet holding the fields that
							     built it — the same fields the desktop keeps on screen at all times, which
							     at 390px would be five controls on a row with room for two. -->
							<div :class="GROUP">
								<button
									v-for="(alert, i) in event.alerts"
									:key="i"
									:class="ROW"
									@click="editingAlert = i"
								>
									<Bell v-if="i === 0" :class="ICON" />
									<span v-else :class="ICON_BLANK" />
									<span class="min-w-0 flex-1 truncate">{{ formatAlertPhrase(alert) }}</span>
									<!-- A chevron, not a ✕: the row leads to the sheet, and removing is one
									     of the things that sheet offers rather than a second control here
									     competing for the same corner. -->
									<ChevronRight :class="CHEVRON" />
								</button>
								<button v-if="event.alerts.length < 3" :class="ROW" @click="addAlert">
									<Bell v-if="!event.alerts.length" :class="ICON" />
									<span v-else :class="ICON_BLANK" />
									<span class="flex-1 text-ink-gray-4">{{ __('Add alert') }}</span>
								</button>
							</div>

							<!-- where it is kept, and how it reads to everyone else -->
							<div :class="GROUP">
								<button
									v-if="store.calendars.data?.length > 1"
									:class="ROW"
									@click="showCalendarSheet = true"
								>
									<CalendarDays :class="ICON" />
									<span class="shrink-0">{{ __('Calendar') }}</span>
									<span :class="VALUE_LONG">{{ eventCalendar?._name }}</span>
									<ChevronRight :class="CHEVRON" />
								</button>
								<button :class="ROW" @click="showAvailabilitySheet = true">
									<Briefcase :class="ICON" />
									<span class="flex-1">{{ __('Availability') }}</span>
									<span :class="VALUE">{{ availabilityLabel }}</span>
									<ChevronRight :class="CHEVRON" />
								</button>
								<button :class="ROW" @click="showVisibilitySheet = true">
									<Eye :class="ICON" />
									<span class="flex-1">{{ __('Visibility') }}</span>
									<span :class="VALUE">{{ visibilityLabel }}</span>
									<ChevronRight :class="CHEVRON" />
								</button>
							</div>

							<div :class="GROUP">
								<textarea
									v-model="event.description"
									rows="3"
									:placeholder="__('Add description')"
									class="w-full resize-none border-0 bg-transparent px-3.5 py-3 text-p-base text-ink-gray-8 placeholder:text-ink-gray-4 focus:ring-0"
								/>
							</div>
						</div>
					</template>
					<template v-else>

						<!-- The participants screen is pushed rather than layered: it owns the search field
						     and the keyboard while it is up, and the way back returns to the form with the
						     list as it now stands. v-show, not v-if, so the form keeps its scroll position and any
						     field mid-edit while the reader is away. -->
						<!-- pt-1, the same 4px the form's title field takes above itself: the header
						     supplies the separation, and both screens start their content the same
						     distance under it. py-3 here had the field sitting 8px lower than anything
						     does on the form. -->
						<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-1">
							<ParticipantSelector
								v-model="event.participants"
								:account="store.accountId"
								:display-participants="participants"
								label=""
								variant="inline"
							/>
						</div>
					</template>
				</div>
			</Transition>
		</template>
	</div>

	<!-- The alert's own fields, on the sheet a tap on its row opens: a row per field,
	     each reading label / value, and each opening a picker of its own. The desktop
	     packs the same five into one line because it has the width for it; here they
	     read as a list, which is also what lets the sentence they add up to sit under
	     them. Removing is here too, with the rest of what can be done to an alert. -->
	<BottomSheet
		:open="editingAlert !== undefined"
		:title="__('Alert')"
		@update:open="(value: boolean) => !value && (editingAlert = undefined)"
	>
		<div v-if="editedAlert" class="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
			<Dropdown :options="alertFieldOptions('action')" align="end">
				<button :class="SHEET_ROW">
					<span class="flex-1 text-left">{{ __('Type') }}</span>
					<span :class="VALUE">{{ labelOf(ALERT_ACTION_OPTIONS, editedAlert.action) }}</span>
					<ChevronDown :class="CHEVRON" />
				</button>
			</Dropdown>
			<Dropdown :options="alertFieldOptions('when')" align="end">
				<button :class="SHEET_ROW">
					<span class="flex-1 text-left">{{ __('When') }}</span>
					<span :class="VALUE">{{ labelOf(ALERT_WHEN_OPTIONS, alertWhen) }}</span>
					<ChevronDown :class="CHEVRON" />
				</button>
			</Dropdown>

			<template v-if="alertWhen === 'absolute'">
				<div :class="SHEET_ROW">
					<span class="flex-1">{{ __('Date') }}</span>
					<input
						:value="editedAlert.date"
						type="date"
						:class="[PILL, 'shrink-0']"
						@input="editAlert('date', ($event.target as HTMLInputElement).value)"
					/>
				</div>
				<div :class="SHEET_ROW">
					<span class="flex-1">{{ __('Time') }}</span>
					<input
						:value="editedAlert.time"
						type="time"
						:class="[PILL, 'shrink-0']"
						@input="editAlert('time', ($event.target as HTMLInputElement).value)"
					/>
				</div>
			</template>

			<template v-else>
				<!-- How long, and in what — a row each. A number is typed and a unit is
				     picked, so the two rows do not behave alike however close they read. -->
				<div :class="SHEET_ROW">
					<span class="flex-1">{{ __('Offset') }}</span>
					<input
						:value="editedAlert.number"
						type="number"
						min="0"
						:class="[PILL, 'w-16 shrink-0 text-right']"
						@input="editAlert('number', Number(($event.target as HTMLInputElement).value))"
					/>
				</div>
				<Dropdown :options="alertFieldOptions('unit')" align="end">
					<button :class="SHEET_ROW">
						<span class="flex-1 text-left">{{ __('Unit') }}</span>
						<span :class="VALUE">{{ labelOf(UNIT_OPTIONS, editedAlert.unit) }}</span>
						<ChevronDown :class="CHEVRON" />
					</button>
				</Dropdown>
				<Dropdown :options="alertFieldOptions('direction')" align="end">
					<button :class="SHEET_ROW">
						<span class="flex-1 text-left">{{ __('Timing') }}</span>
						<span :class="VALUE">{{ labelOf(DIRECTION_OPTIONS, editedAlert.direction) }}</span>
						<ChevronDown :class="CHEVRON" />
					</button>
				</Dropdown>
				<Dropdown :options="alertFieldOptions('relative_to')" align="end">
					<button :class="SHEET_ROW">
						<span class="flex-1 text-left">{{ __('Relative to') }}</span>
						<span :class="VALUE">{{ labelOf(RELATIVE_TO_OPTIONS, editedAlert.relative_to) }}</span>
						<ChevronDown :class="CHEVRON" />
					</button>
				</Dropdown>
			</template>

			<!-- A rule above it, and the only one on the sheet: the fields are a list to
			     read down, and this is not one of them. -->
			<button
				class="w-full border-t border-outline-gray-1 py-3 text-left text-p-base text-ink-red-5"
				@click="removeEditedAlert"
			>
				{{ __('Remove alert') }}
			</button>
		</div>
	</BottomSheet>

	<!-- Mail's sheet, not one of our own: a row whose value is one of a few is the same
	     question there and here, and AdaptiveDropdown already answers it — the options as a
	     sheet on a phone, the same options as a dropdown on a desktop. It closes itself when
	     one is picked, so the row's own flag only has to open it. -->
	<AdaptiveDropdown
		v-model:open="showCalendarSheet"
		:title="__('Calendar')"
		:options="calendarOptions"
	/>
	<AdaptiveDropdown
		v-model:open="showAvailabilitySheet"
		:title="__('Availability')"
		:options="availabilityOptions"
	/>
	<AdaptiveDropdown
		v-model:open="showVisibilitySheet"
		:title="__('Visibility')"
		:options="visibilityOptions"
	/>
</template>

<script setup lang="ts">
import { computed, h, nextTick, ref, watch } from 'vue'
import {
	Bell,
	Briefcase,
	CalendarDays,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clock,
	Eye,
	MapPin,
	Repeat,
	Users,
	X,
} from 'lucide-vue-next'
import { Avatar, BottomSheet, Button, Dropdown, Switch } from 'frappe-ui'

import meetLogo from '@/assets/app-logos/meet.png'
import dayjs from '@/apps/calendar/utils/dayjs'
import { eventColor } from '@/apps/calendar/utils/color'
import { formatAlertPhrase, getRepeatMessage } from '@/apps/calendar/utils/format'
import {
	ALERT_ACTION_OPTIONS,
	DIRECTION_OPTIONS,
	RELATIVE_TO_OPTIONS,
	UNIT_OPTIONS,
	VISIBILITY_OPTIONS,
} from '@/apps/calendar/utils/eventOptions'
import { userStore } from '@/apps/calendar/stores/user'
import { requestAlertPermission } from '@/utils/calendarAlert'
import { useKeyboardInsets } from '@/composables/useKeyboardInsets'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import ParticipantSelector from '@/apps/calendar/components/ParticipantSelector.vue'

const { event, participants } = defineProps<{
	/** The form state EventModal owns; the rows edit it in place. */
	event: any
	title: string
	isNew: boolean
	disableSave: boolean
	participants: any[]
	meetUrl?: string
	meetLinkDisplay?: string
}>()

const emit = defineEmits<{
	cancel: []
	save: []
	toggleRepeat: []
	setAllDay: [value: boolean]
	setAlerts: [alerts: any[]]
	joinMeet: []
}>()

const store = userStore()
const { height: viewportHeight, top: keyboardTop } = useKeyboardInsets()

const SCREENS = ['form', 'participants'] as const
/** Which of the two screens is up. Participants is pushed from the form and returns to it. */
const screen = ref<(typeof SCREENS)[number]>('form')

// The mark in the header is one button on both screens, so a tap that goes back leaves its
// focus on the button the form then shows: a ✕ sitting highlighted for something the reader
// did to a chevron. The tap is spent when the screen changes, so the focus goes with it.
const leaveScreen = (event: MouseEvent) => {
	;(event.currentTarget as HTMLElement | null)?.blur()
	if (screen.value === 'form') emit('cancel')
	else screen.value = 'form'
}

const GROUP = 'mx-4 mb-3 divide-y divide-outline-gray-1 overflow-hidden rounded-7 bg-surface-gray-1'
const ROW = 'flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left text-p-base text-ink-gray-8'
// The size lives on the class, not on each icon's own `:size` attribute — a CSS
// width beats the width attribute lucide renders, so an attribute here would be
// quietly ignored. It is also the only way the glyphs and the spacer that stands
// in for a missing one (a span, which has no `:size`) can be the same width; when
// they were not, the rows below the first in a group sat indented against it.
//
// 16 rather than 20, matching the desktop modal: at 20 the boxy glyphs — the
// calendar, the briefcase — filled their frame corner to corner and read a size
// above the round ones beside them.
const ICON = 'size-4 shrink-0 text-ink-gray-5'
/** The blank that keeps a row's label on the icon column when it carries no icon. */
const ICON_BLANK = 'size-4 shrink-0'
const CHEVRON = 'size-4 shrink-0 text-ink-gray-4'

/** A row on the alert sheet: label, value, and whatever opens it. */
const SHEET_ROW = 'flex w-full items-center gap-2 py-3 text-p-base text-ink-gray-8'
// The label's size, and only the label's colour changed. A smaller value read as centred
// against the label but not aligned with it: `items-center` centres the two boxes, and two
// line-heights centred on one line put the larger text's baseline lower — the row's label
// sat below its own value. What separates a value from its label here is ink, not size.
const VALUE = 'shrink-0 text-ink-gray-5'
// A value that can run long — a repeat rule names every day it falls on — takes what the
// label leaves and truncates there, rather than growing the row until the chevron is off
// the end of it.
const VALUE_LONG = 'min-w-0 flex-1 truncate text-right text-ink-gray-5'
// 8px between the two, closer than the row's own 12px gap: a date and the time on it are
// one value read together, not two of the row's items.
const PILL_PAIR = 'flex shrink-0 items-center gap-2'
// The pair carries the width and the two split it 3:2, rather than each pill being sized
// on its own. A width per pill cannot be right everywhere: a date runs "08/09/2026" or
// "9/8/2026" depending on the platform's locale, and a time is "15:00" or "3:00 PM" — one
// number that fits both left the other either clipped or swimming. Sharing a fixed pair
// keeps Starts and Ends on the same x, which is the thing that has to hold.
const PILL_DATE = 'min-w-0 flex-[3]'
const PILL_TIME = 'min-w-0 flex-[2]'
// The picker indicator goes: it is 20px of chrome for an affordance the whole pill already
// is - tapping anywhere on it opens the picker - and it is what pushed the pair past the
// width a phone has for it.
const PILL =
	'rounded-4 border-outline-gray-2 bg-surface-base px-2 py-1 text-p-sm tabular-nums text-ink-gray-8 focus:border-outline-gray-3 focus:ring-0 [&::-webkit-calendar-picker-indicator]:hidden'

const AVAILABILITY_OPTIONS = [
	{ label: __('Busy'), value: 'Busy' },
	{ label: __('Free'), value: 'Free' },
]

const availabilityLabel = computed(
	() => AVAILABILITY_OPTIONS.find((option) => option.value === event.free_busy_status)?.label ?? '',
)

const visibilityLabel = computed(
	() => VISIBILITY_OPTIONS.find((option) => option.value === event.privacy)?.label ?? '',
)

// The same two lists again, in the shape AdaptiveDropdown reads: what to call it, whether
// it is the one in effect, and what picking it does.
const asDropdownOptions = (
	options: { label: string; value: string }[],
	current: () => string,
	choose: (value: string) => void,
) =>
	options.map((option) => ({
		label: option.label,
		selected: current() === option.value,
		onClick: () => choose(option.value),
	}))

const eventCalendar = computed(() =>
	store.calendars.data?.find((cal) => cal.id === event.calendar_ids?.[0]),
)

const calendarOptions = computed(() =>
	(store.calendars.data ?? []).map((cal) => ({
		label: cal._name,
		icon: h('span', { class: 'grid place-items-center' }, [
			h('span', { class: 'size-2 rounded-full', style: { background: eventColor(cal.color) } }),
		]),
		selected: event.calendar_ids?.[0] === cal.id,
		onClick: () => (event.calendar_ids = [cal.id]),
	})),
)

const availabilityOptions = computed(() =>
	asDropdownOptions(
		AVAILABILITY_OPTIONS,
		() => event.free_busy_status,
		(value) => (event.free_busy_status = value),
	),
)

const visibilityOptions = computed(() =>
	asDropdownOptions(
		VISIBILITY_OPTIONS,
		() => event.privacy,
		(value) => (event.privacy = value),
	),
)

// The row says what the event does, not what the control is called: "Never" is the value
// the desktop's unchecked checkbox stands for, spelled out because a row has to read as a
// statement on its own.
const repeatValue = computed(() =>
	event.recurrence_rule?.frequency ? getRepeatMessage(event.recurrence_rule) : __('Never'),
)

// Three locations is the desktop's ceiling; the row that adds one goes when it is reached.
const canAddLocation = computed(() => event.locations.length < 3)

const locationsEl = ref<HTMLElement | null>(null)

// The row you just asked for is the one you want to type in, and the button that made it
// stays below for the next one. The desktop's addLocation does the same by hand; the focus
// is on a DOM this component owns, so it cannot be the same call.
const addLocation = async () => {
	event.locations.push('')
	await nextTick()
	const inputs = locationsEl.value?.querySelectorAll('input')
	inputs?.[inputs.length - 1]?.focus()
}

// --- Alerts ---

const offsetAlert = (number: number, unit: string) => ({
	type: 'OffsetTrigger',
	action: 'Display',
	number,
	unit,
	direction: -1,
	relative_to: 'Start',
})

/** The desktop's "On Specific Date": a real date and time. */
const absoluteAlert = () => ({
	type: 'AbsoluteTrigger',
	action: 'Display',
	date: dayjs(event.startDate).subtract(1, 'day').format('YYYY-MM-DD'),
	time: '09:00',
})

/** Which kind of trigger the alert is, as a value the sheet can pick. */
const ALERT_WHEN_OPTIONS = [
	{ label: __('Relative'), value: 'relative' },
	{ label: __('On date'), value: 'absolute' },
]

/** Which alert the sheet is editing, if any. */
const editingAlert = ref<number | undefined>(undefined)

/**
 * The alert the sheet is showing — held rather than derived, so it survives the
 * sheet closing.
 *
 * Closing clears `editingAlert`, and a body rendered straight off that emptied on
 * the first frame while the sheet was still animating out: the fields vanished, then
 * an empty sheet slid down after them. This keeps the last one it was given until
 * the sheet opens on another, which is what leaves something to slide away.
 */
const editedAlert = ref<any>(null)

watch(
	() => (editingAlert.value === undefined ? null : event.alerts[editingAlert.value]),
	(alert) => alert && (editedAlert.value = alert),
	{ immediate: true },
)

const editAlert = (field: string, value: string | number) => {
	const index = editingAlert.value
	if (index === undefined) return
	emit(
		'setAlerts',
		event.alerts.map((alert: object, i: number) => (i === index ? { ...alert, [field]: value } : alert)),
	)
}

const alertWhen = computed(() =>
	editedAlert.value?.type === 'AbsoluteTrigger' ? 'absolute' : 'relative',
)

/** The label a value goes by, for a row that shows one and hides the rest. */
const labelOf = (options: { label: string; value: string | number }[], value: unknown) =>
	options.find((option) => option.value === value)?.label ?? ''

/** The fields the sheet lets a reader change, and where each one's value lives. */
type AlertField = 'action' | 'when' | 'unit' | 'direction' | 'relative_to'

const ALERT_FIELDS: Record<
	AlertField,
	{ options: { label: string; value: string | number }[]; current: () => unknown }
> = {
	action: { options: ALERT_ACTION_OPTIONS, current: () => editedAlert.value?.action },
	when: { options: ALERT_WHEN_OPTIONS, current: () => alertWhen.value },
	unit: { options: UNIT_OPTIONS, current: () => editedAlert.value?.unit },
	direction: { options: DIRECTION_OPTIONS, current: () => editedAlert.value?.direction },
	relative_to: { options: RELATIVE_TO_OPTIONS, current: () => editedAlert.value?.relative_to },
}

/**
 * A field's values as menu items, the current one ticked.
 *
 * The tick is drawn into the item's suffix rather than left to the menu's own
 * `selected`, which fills the row grey instead — and a filled row in an open menu
 * reads as the one under the pointer, not the one already chosen.
 */
const alertFieldOptions = (field: AlertField) =>
	ALERT_FIELDS[field].options.map((option) => ({
		label: option.label,
		onClick: () => applyAlertField(field, option.value),
		slots:
			option.value === ALERT_FIELDS[field].current()
				? { suffix: () => h(Check, { class: 'size-4 shrink-0 text-ink-gray-7' }) }
				: undefined,
	}))

const applyAlertField = (field: AlertField, value: string | number) => {
	const index = editingAlert.value
	if (index === undefined) return

	// Changing what kind of trigger it is replaces the alert: the two carry different
	// fields, and a date left on an offset trigger is a value nothing reads.
	if (field === 'when') {
		if (value === alertWhen.value) return
		const action = editedAlert.value?.action
		const replacement = value === 'absolute' ? absoluteAlert() : offsetAlert(10, 'minutes')
		return emit(
			'setAlerts',
			event.alerts.map((alert: object, i: number) =>
				i === index ? { ...replacement, action: action ?? 'Display' } : alert,
			),
		)
	}

	// `direction` is -1 or 1; everything else is a string.
	editAlert(field, field === 'direction' ? Number(value) : String(value))
}

const removeEditedAlert = () => {
	const index = editingAlert.value
	editingAlert.value = undefined
	if (index !== undefined)
		emit(
			'setAlerts',
			event.alerts.filter((_: unknown, i: number) => i !== index),
		)
}

// Added and opened in one tap: which kind it should be is a question the event has
// already answered. An all-day event has no time for an offset to count back from —
// "10 minutes before" a day is not a moment — so it takes a date and a time of its
// own; anything else counts from when it starts. Either way the sheet opens on the
// fields, which is where the reader was going.
const addAlert = () => {
	const index = event.alerts.length
	emit('setAlerts', [...event.alerts, event.isAllDay ? absoluteAlert() : offsetAlert(10, 'minutes')])
	editingAlert.value = index
}

// Adding a reminder is the user saying they want to be told: the one moment to
// ask the browser for system notifications, while the tap still counts. The
// desktop's list asks at the same moment; a Display alert saved without asking
// could never show.
watch(
	() => event.alerts.length,
	(count: number, previous: number) => count > previous && requestAlertPermission(),
)

const showCalendarSheet = ref(false)
const showAvailabilitySheet = ref(false)
const showVisibilitySheet = ref(false)
</script>

<style scoped>
/* The screen slide: a push, both screens moving at once, the leaving one lifted
   out of the flow so the arriving one has the box from the first frame. The
   detail sheet's page turn, to the millisecond. */
.screen-form-enter-active,
.screen-form-leave-active,
.screen-participants-enter-active,
.screen-participants-leave-active {
	transition: transform 200ms ease;
}
.screen-form-leave-active,
.screen-participants-leave-active {
	position: absolute;
	inset: 0;
}
.screen-form-enter-from,
.screen-form-leave-to {
	transform: translateX(-100%);
}
.screen-participants-enter-from,
.screen-participants-leave-to {
	transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
	.screen-form-enter-active,
	.screen-form-leave-active,
	.screen-participants-enter-active,
	.screen-participants-leave-active {
		transition: none;
	}
}
</style>
