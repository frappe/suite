<template>
	<CommandPalette
		v-model:open="root.paletteOpen"
		v-model:query="query"
		:class="{ 'mail-mobile-search-page': mailSearchOnly }"
		:filterable="false"
		title="Search Suite"
		@keydown.capture="handlePaletteEnter"
		@select="selectItem"
	>
		<DialogDescription class="sr-only">
			Search across Suite apps, commands, and content.
		</DialogDescription>
		<CommandPaletteInput
			ref="paletteInput"
			:placeholder="
				mailAppliedFilters.length && !mailSearchOnly
					? `Search · ${removeMailFilterShortcut} removes last filter`
					: hasFilterPanel
						? 'Search'
					: palettePlaceholder
			"
			@mousedown="showFilters = false"
			@input="showFilters = false"
			@keydown.backspace="handleMailFilterBackspace"
		>
			<template #prefix>
				<button
					v-if="mailSearchOnly"
					type="button"
					class="flex shrink-0"
					aria-label="Back"
					@click="leaveMobileSearch"
				>
					<span class="lucide-arrow-left size-4 text-ink-gray-5" />
				</button>
				<span v-else class="lucide-search size-4 shrink-0 text-ink-gray-6" />
			</template>
			<template v-if="hasFilterPanel" #suffix>
				<Button
					:variant="showFilters ? 'subtle' : 'ghost'"
					icon="lucide-sliders-horizontal"
					size="sm"
					aria-label="Filters"
					:aria-expanded="showFilters"
					@mousedown.prevent
					@click="toggleFilters"
				/>
			</template>
		</CommandPaletteInput>

		<div
			v-if="mailSearchActive && !showFilters"
			class="mail-search-filters relative flex shrink-0 flex-wrap items-center gap-1.5 px-4 py-2"
			:class="{ 'pr-12': mailAppliedFilters.length && !mailSearchOnly }"
		>
			<span
				v-for="filter in mailAppliedFilters"
				:key="filter.key"
				class="inline-flex h-7 shrink-0 items-center gap-1 rounded-4 bg-surface-gray-2 pl-2 pr-1 text-xs"
			>
				<!-- Clicking what a badge says either flips it, for a filter with two answers, or hands
				     it back to the query line to be edited; the ✕ beside it is for dropping it. A
				     <span> rather than a <button>: a button brought its own box and centred text,
				     which laid the label out differently from the plain badge beside it and clipped
				     its first letter. -->
				<Tooltip :text="`Click to ${mailFilterVerb(filter.key).toLowerCase()}`">
					<span
						class="max-w-40 cursor-pointer truncate hover:text-ink-gray-8"
						role="button"
						tabindex="0"
						:aria-label="`${mailFilterVerb(filter.key)} ${getMailFilterLabel(filter)}`"
						@mousedown.prevent
						@click.stop="activateMailFilter(filter.key)"
						@keydown.enter.space.prevent="activateMailFilter(filter.key)"
					>{{ getMailFilterLabel(filter) }}</span>
				</Tooltip>
				<button
					class="rounded-4 p-1 text-ink-gray-5 hover:text-ink-gray-8"
					aria-label="Remove filter"
					@mousedown.prevent
					@click.stop="removeMailFilter(filter.key)"
				>
					<span class="lucide-x size-3" aria-hidden="true" />
				</button>
			</span>
			<Button
				v-for="option in availableMailFilterOptions"
				:key="option.key"
				variant="outline"
				size="sm"
				class="!h-7 text-xs"
				@mousedown.prevent
				@click="applyMailQuickFilter(option)"
			>
				<span class="flex items-center gap-1">
					<span class="lucide-plus size-3" aria-hidden="true" />
					{{ option.label }}
				</span>
			</Button>
			<!-- A word on the phone, where there is no tooltip to say what the × does, and in
			     the row after the last chip rather than pinned to its corner: chips wrap on a
			     phone, and a corner is on one of their lines or none. -->
			<Button
				v-if="mailAppliedFilters.length"
				variant="ghost"
				:icon="mailSearchOnly ? undefined : 'lucide-x'"
				:label="mailSearchOnly ? __('Clear') : undefined"
				size="sm"
				class="mail-search-clear"
				:class="mailSearchOnly ? '-ml-0.5' : 'absolute right-4 top-2 !size-7 !p-0'"
				aria-label="Clear all filters"
				:tooltip="mailSearchOnly ? undefined : 'Clear filters'"
				@mousedown.prevent
				@click="mailAppliedFilters = []"
			/>
		</div>

		<CalendarFilterBadges
			v-if="calendarSearchActive && !showFilters"
			:badges="calendarBadges"
			@edit="editCalendarFilter"
			@remove="removeCalendarFilter"
			@clear="resetCalendarFilters"
		/>

		<CalendarFilterPanel
			v-if="calendarSearchActive && showFilters"
			:filter="calendarFilter"
			:focus-field="calendarFilterToEdit"
			:account="String(route.params.accountId || '')"
			:calendar-options="calendarFilterOptions"
		/>

		<MailFilterPanel
			v-else-if="mailSearchActive && showFilters"
			v-model:filters="mailPanelFilters"
			v-model:all-accounts="mailAllAccounts"
			:has-multiple-accounts="hasMultipleMailAccounts"
		/>

		<CommandPaletteList v-else>
			<!-- What the reader searched for last, on the phone's page while nothing is asked:
			     the page is a list and, until a word arrives, this is its whole content. Inside
			     the list rather than above it, so a row is a listbox item the keyboard and the
			     select event both reach. The group's own top margin goes, since the header row
			     here stands where the group's label would. -->
			<template
				v-if="
					mailSearchOnly &&
					!normalizedQuery &&
					!mailAppliedFilters.length &&
					recentMailSearches.length
				"
			>
				<div class="mb-2.5 mt-3 flex items-center justify-between px-5 text-base text-ink-gray-5">
					<span>Recent</span>
					<button
						type="button"
						class="text-sm text-ink-gray-5 hover:text-ink-gray-8"
						@mousedown.prevent
						@click="clearRecentMailSearches"
					>
						Clear
					</button>
				</div>
				<CommandPaletteGroup class="!mt-0">
					<CommandPaletteItem
						v-for="recent in recentMailSearches"
						:key="mailSearchKey(recent)"
						:value="recent"
					>
						<template #prefix>
							<span
								class="mr-3 flex size-5 shrink-0 items-center justify-center text-ink-gray-7"
							>
								<span class="lucide-history size-5" aria-hidden="true" />
							</span>
						</template>
						<span class="truncate">{{ recent.label }}</span>
						<template #suffix>
							<button
								class="rounded-4 p-1 text-ink-gray-5 hover:text-ink-gray-8"
								aria-label="Remove from recent searches"
								@mousedown.prevent
								@click.stop="forgetMailSearch(recent)"
							>
								<span class="lucide-x size-3.5" aria-hidden="true" />
							</button>
						</template>
					</CommandPaletteItem>
				</CommandPaletteGroup>
			</template>
			<CommandPaletteGroup
				v-if="!navigationMode && !normalizedQuery && paletteRecents.length"
				label="Recent"
			>
				<CommandPaletteItem
					v-for="recent in paletteRecents"
					:key="recent.name"
					:value="recent"
				>
					<template #prefix>
						<DriveSearchResultIcon :entity="recent" />
					</template>
					{{ recent.file_name }}
					<template #suffix>
						<DriveSearchResultModified :modified="recent.modified" />
					</template>
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<CommandPaletteGroup
				v-if="navigationMode && exactApps.length"
				label="Navigate"
			>
				<CommandPaletteItem
					v-for="app in exactApps"
					:key="app.name"
					:value="app"
				>
					<template #prefix>
						<img
							:src="app.logo"
							alt=""
							class="mr-3 size-4 shrink-0 scale-[1.2] rounded-1"
						/>
					</template>
					{{ app.title }}
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<CommandPaletteGroup v-if="filteredCommands.length" label="Suggested">
				<CommandPaletteItem
					v-for="command in filteredCommands"
					:key="command.id"
					:value="command"
					:disabled="command.disabled"
				>
					<template #prefix>
						<span
							class="mr-3 flex size-4 shrink-0 items-center justify-center text-ink-gray-7"
						>
							<span
								:class="command.icon || 'lucide-command'"
								class="size-4"
								aria-hidden="true"
							/>
						</span>
					</template>
					{{ command.label }}
					<template v-if="command.shortcut" #suffix>
						<KeyboardShortcut
							class="palette-command-shortcut"
							:combo="command.shortcut"
							bg
						/>
					</template>
					<template v-else-if="command.description" #suffix>
						<span class="text-p-xs text-ink-gray-5">{{
							command.description
						}}</span>
					</template>
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<CommandPaletteGroup v-if="driveResults.length" label="Drive">
				<CommandPaletteItem
					v-for="entity in driveResults"
					:key="entity.name"
					:value="entity"
				>
					<template #prefix>
						<DriveSearchResultIcon :entity="entity" />
					</template>
					<HighlightedText :text="entity.file_name" :term="searchWords" />
					<template #suffix>
						<DriveSearchResultModified :modified="entity.modified" />
					</template>
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<CommandPaletteGroup v-if="sheetResults.length" label="Sheets">
				<CommandPaletteItem
					v-for="sheet in sheetResults"
					:key="sheet.name"
					:value="sheet"
				>
					<template #prefix>
						<DriveSearchResultIcon :entity="sheet" />
					</template>
					<HighlightedText :text="sheet.title || 'Untitled Sheet'" :term="searchWords" />
					<template #suffix>
						<DriveSearchResultModified :modified="sheet.modified" />
					</template>
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<CommandPaletteGroup v-if="slideResults.length" label="Slides">
				<CommandPaletteItem
					v-for="presentation in slideResults"
					:key="presentation.name"
					:value="presentation"
				>
					<template #prefix>
						<DriveSearchResultIcon :entity="presentation" />
					</template>
					<HighlightedText :text="presentation.file_name" :term="searchWords" />
					<template #suffix>
						<DriveSearchResultModified :modified="presentation.modified" />
					</template>
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<CommandPaletteGroup v-if="writerResults.length" label="Writer">
				<CommandPaletteItem
					v-for="document in writerResults"
					:key="document.name"
					:value="document"
				>
					<template #prefix>
						<DriveSearchResultIcon :entity="document" />
					</template>
					<HighlightedText :text="document.title || 'Untitled Document'" :term="searchWords" />
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<CommandPaletteGroup v-if="meetResults.length" label="Meet">
				<CommandPaletteItem
					v-for="meeting in meetResults"
					:key="meeting.name"
					:value="meeting"
				>
					<template #prefix>
						<span
							class="mr-3 flex size-4 shrink-0 items-center justify-center text-ink-gray-7"
						>
							<span class="lucide-video size-4" aria-hidden="true" />
						</span>
					</template>
					<HighlightedText :text="meeting.title || meeting.name" :term="searchWords" />
					<template #suffix>
						<DriveSearchResultModified :modified="meeting.modified" />
					</template>
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<!-- Unlabelled, the way mail's results are: the palette is already scoped to the app
			     in view, so a heading naming that app says nothing the reader did not just do. -->
			<CommandPaletteGroup v-if="calendarResults.length" :label="resultsLabel('Events')">
				<CommandPaletteItem
					v-for="event in calendarResults"
					:key="event.name"
					:value="event"
					class="[&_[data-slot=command-palette-item-label]]:flex-1"
				>
					<!-- No prefix of its own: the row leads with the date chip, which is the
					     thing a reader scans a list of events by. -->
					<CalendarSearchResult
						:result="event"
						:calendar-options="calendarFilterOptions"
						:term="searchWords"
					/>
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<MailSearchSuggestions :suggestions="mailSuggestions" :roomy="mailSearchOnly" />

			<CommandPaletteGroup v-if="mailResults.length" :label="resultsLabel('Messages')">
				<CommandPaletteItem
					v-for="mail in mailResults"
					:key="`${mail.account}-${mail.thread_id}`"
					:value="mail"
					class="group [&_[data-slot=command-palette-item-label]]:flex-1"
				>
					<MailSearchResult :result="mail" :term="mailSearchWords" />
				</CommandPaletteItem>
				<!-- Last, not first: the palette activates its first item, and Enter on a search
				     belongs to the mail you were looking for. This is the way out to the results
				     page, where the whole set can be acted on at once — so it is here only when
				     there is a set larger than the rows above it. -->
				<CommandPaletteItem
					v-if="mailTotal > mailResults.length"
					:value="mailSearchPageItem"
				>
					<template #prefix>
						<span
							class="mr-3 flex size-4 shrink-0 items-center justify-center text-ink-gray-7"
						>
							<span class="lucide-arrow-right size-4" aria-hidden="true" />
						</span>
					</template>
					{{ mailSearchPageLabel }}
				</CommandPaletteItem>
			</CommandPaletteGroup>

			<CommandPaletteGroup
				v-if="navigationMode && remainingApps.length"
				label="Navigate"
			>
				<CommandPaletteItem
					v-for="app in remainingApps"
					:key="app.name"
					:value="app"
				>
					<template #prefix>
						<img
							:src="app.logo"
							alt=""
							class="mr-3 size-4 shrink-0 scale-[1.2] rounded-1"
						/>
					</template>
					{{ app.title }}
				</CommandPaletteItem>
			</CommandPaletteGroup>
		</CommandPaletteList>

		<!-- Anything that counts as having been asked gets an answer, even "nothing matched".
		     A calendar filter is a question with no words in it, and left out of this the
		     palette met one with a blank panel that never said whether it had run. -->
		<CommandPaletteEmpty
			v-if="
				!showFilters &&
				(normalizedQuery || mailAppliedFilters.length || calendarFilterAsked)
			"
		>
			{{ emptyMessage }}
		</CommandPaletteEmpty>

		<CommandPaletteFooter
			v-slot="{ active }"
			class="!justify-between !px-2.5 !text-xs"
		>
			<span class="flex items-center gap-4">
				<span class="flex items-center gap-1">
					<span
						class="inline-flex items-center rounded-1 bg-surface-gray-2 p-0.5 text-ink-gray-5"
					>
						<span class="lucide-arrow-down size-4" />
					</span>
					<span
						class="inline-flex items-center rounded-1 bg-surface-gray-2 p-0.5 text-ink-gray-5"
					>
						<span class="lucide-arrow-up size-4" />
					</span>
					<span>to navigate</span>
				</span>
				<span class="flex items-center gap-1">
					<span
						class="inline-flex items-center rounded-1 bg-surface-gray-2 px-1 py-0.5 text-[11px] text-ink-gray-5"
						>esc</span
					>
					<span>to close</span>
				</span>
				<span
					v-if="!navigationMode && !mailSearchOnly"
					class="flex items-center gap-1"
				>
					<span
						class="inline-flex items-center rounded-1 bg-surface-gray-2 px-1 py-0.5 text-[11px] text-ink-gray-5"
						>&gt;</span
					>
					<span>to switch apps</span>
				</span>
			</span>
			<span class="flex min-w-40 items-center justify-end gap-1">
				<span
					class="inline-flex items-center rounded-1 bg-surface-gray-2 p-0.5 text-ink-gray-5"
				>
					<span class="lucide-corner-down-left size-4" />
				</span>
				<span>{{ enterHint(active) }}</span>
			</span>
		</CommandPaletteFooter>
	</CommandPalette>
</template>

<script setup lang="ts">
import {
	computed,
	defineAsyncComponent,
	nextTick,
	onScopeDispose,
	ref,
	watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import {
	Button,
	createResource,
	KeyboardShortcut,
	Tooltip,
	useKeyboardShortcut,
} from 'frappe-ui'
import {
	CommandPalette,
	CommandPaletteEmpty,
	CommandPaletteFooter,
	CommandPaletteGroup,
	CommandPaletteInput,
	CommandPaletteItem,
	CommandPaletteList,
	type CommandPaletteSelectEvent,
} from 'frappe-ui/experimental'
import { DialogDescription } from 'reka-ui'
import { getAppSwitcherItems, type SuiteAppSwitcherItem } from '@/apps/registry'
import {
	useMailCommandPaletteSearch,
	type MailFilterOption,
} from '@/apps/mail/composables/useMailCommandPaletteSearch'
import { userStore } from '@/apps/mail/stores/user'
import {
	mailSearchRoute,
	useMobileSearch,
	useScreenSize,
} from '@/apps/mail/utils/composables'
import MailFilterPanel from '@/apps/mail/components/CommandPalette/MailFilterPanel.vue'
import CalendarFilterPanel from '@/apps/calendar/components/CommandPalette/CalendarFilterPanel.vue'
import CalendarFilterBadges from '@/apps/calendar/components/CommandPalette/CalendarFilterBadges.vue'
import MailSearchResult from '@/apps/mail/components/CommandPalette/MailSearchResult.vue'
import MailSearchSuggestions from '@/apps/mail/components/CommandPalette/MailSearchSuggestions.vue'
import CalendarSearchResult from '@/apps/calendar/components/CommandPalette/CalendarSearchResult.vue'
import HighlightedText from '@/components/HighlightedText.vue'
import { parseMailSearchQuery } from '@/apps/mail/components/CommandPalette/searchQuery'
import type {
	MailContactSuggestion,
	MailFilterSuggestion,
	MailRecentSearch,
	MailSearchResult as MailResult,
} from '@/apps/mail/components/CommandPalette/types'
import { getRecents } from '@/apps/drive/resources/files'
import dayjs from '@/apps/calendar/utils/dayjs'
import { userStore as calendarUserStore } from '@/apps/calendar/stores/user'
import { useCalendarSearchFilters } from '@/apps/calendar/composables/useCalendarSearchFilters'
import type { CalendarSearchResult as CalendarSearchResultItem } from '@/apps/calendar/components/CommandPalette/types'
import { eventStartLocal } from '@/apps/calendar/utils/eventTime'
import { useRootStore, type PaletteCommand } from '@/stores/root'

interface DriveResult {
	name: string
	file_name: string
	file_type?: string
	is_folder: boolean
	modified?: string
	user_name?: string
	full_name?: string
	[key: string]: unknown
}

interface SheetResult {
	resultType: 'sheet'
	name: string
	title?: string
	modified?: string
	content_doctype: 'Sheet'
	file_type: 'Spreadsheet'
	[key: string]: unknown
}

interface SlideResult {
	resultType: 'slide'
	name: string
	file_name: string
	content_docname: string
	modified?: string
	thumbnail?: string
	owner?: string
	content_doctype: 'Presentation'
	[key: string]: unknown
}

interface WriterResult {
	resultType: 'writer'
	name: string
	title?: string
	content_doctype: 'Writer Document'
	file_type: 'Document'
	[key: string]: unknown
}

interface MeetResult {
	resultType: 'meeting'
	name: string
	title?: string
	modified?: string
}

interface MailSearchPageItem {
	resultType: 'mail-search-page'
}

type PaletteItem =
	| MailSearchPageItem
	| DriveResult
	| SheetResult
	| SlideResult
	| WriterResult
	| MeetResult
	| CalendarSearchResultItem
	| MailResult
	| MailContactSuggestion
	| MailFilterSuggestion
	| MailRecentSearch
	| PaletteCommand
	| SuiteAppSwitcherItem

const minimumQueryLength = 3
// The calendar answers from the first character. Its titles are short and usually a name, the
// server matches whole words rather than prefixes, and one letter over a few hundred events is
// a list — not the flood a document search would return, which is what the longer floor is for.
const calendarMinimumQueryLength = 1
// As many events as the palette shows at once, the way mail bounds its own hits: past ten, a
// reader is scrolling a list rather than reading an answer, and the search wants narrowing.
// Events, not rows — a recurring one comes back as its next few occurrences, and the server
// counts the cap before it expands them, so the rows are not sliced again here.
const CALENDAR_RESULT_LIMIT = 10
const DriveSearchResultIcon = defineAsyncComponent(
	() => import('@/apps/drive/components/DriveSearchResultIcon.vue')
)
const DriveSearchResultModified = defineAsyncComponent(
	() => import('@/apps/drive/components/DriveSearchResultModified.vue')
)
const root = useRootStore()
const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const { hasSearchQuery: mailHasSearchQuery } = useMobileSearch()
const removeMailFilterShortcut = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
	? '⌘⌫'
	: 'Ctrl+Backspace'
const paletteInput = ref<{ $el: HTMLElement } | null>(null)
// The field itself: CommandPaletteInput exposes nothing, so it is found under the component.
const paletteInputEl = () =>
	paletteInput.value?.$el.querySelector<HTMLInputElement>('input')
const query = ref('')
// On a phone the palette is mail's search and nothing else: it is raised by the search button on
// the mail route and by nothing anywhere else, so the app switcher and the commands are weight
// with no way in — and a row of app icons is not what a thumb reached for the search for.
//
// Keyed on the app, not on the search route, because the search page's look has to survive
// leaving that route: Back out of an empty search pops the route while the editor is still
// fading, and a page-mode class tied to the route fell off mid-fade, leaving the ordinary
// centred dialog to finish the animation.
const mailSearchOnly = computed(
	() => isMobile.value && mailSearchActive.value
)

// App switching is a `>` on the query line rather than a flag remembered beside it: the mode is
// then something you can see you are in, and deleting the character is the way out — no keystroke
// of its own to learn, and nothing to get out of step with what the line says.
const navigationMode = computed(
	() => !mailSearchOnly.value && query.value.trimStart().startsWith('>')
)
const activeApp = computed(() => String(route.meta.appId ?? ''))
const paletteRecents = computed<DriveResult[]>(() => {
	if (!Array.isArray(getRecents.data)) return []
	const recents = getRecents.data.filter((entity: DriveResult) => {
		if (activeApp.value === 'drive') return true
		if (activeApp.value === 'slides')
			return entity.content_doctype === 'Presentation'
		if (activeApp.value === 'sheets') return entity.content_doctype === 'Sheet'
		if (activeApp.value === 'writer')
			return entity.content_doctype === 'Writer Document'
		return false
	})
	return recents.slice(0, 5)
})
const isMailSearchRoute = computed(
	() => mailSearchActive.value && route.params.mailbox === 'search'
)
const mailSearchActive = computed(() => activeApp.value === 'mail')
const {
	allAccounts: mailAllAccounts,
	appliedFilters: mailAppliedFilters,
	availableFilterOptions: availableMailFilterOptions,
	filter: mailFilter,
	filterValues: mailFilterValues,
	hasMultipleAccounts: hasMultipleMailAccounts,
	pending: mailSearchPending,
	searchesAllAccounts: mailSearchesAllAccounts,
	operatorContext: mailOperatorContext,
	results: mailResults,
	suggestions: mailSuggestions,
	total: mailTotal,
	absorbQueryFilters: absorbMailQueryFilters,
	applyFilter: applyMailFilter,
	canInvert: canInvertMailFilter,
	editFilter: editMailFilterValue,
	invertFilter: invertMailFilter,
	useOperator: useMailOperator,
	removeFilter: removeMailFilter,
	setFilters: setMailFilters,
	getFilterLabel: getMailFilterLabel,
	selectContact: selectMailContact,
	selectFilterSuggestion: selectMailFilterSuggestion,
	search: searchMail,
	cancel: cancelMailSearch,
	reset: resetMailSearch,
	recentSearches: recentMailSearches,
	rememberSearch: rememberMailSearch,
	restoreSearch: restoreMailSearch,
	forgetSearch: forgetMailSearch,
	clearRecentSearches: clearRecentMailSearches,
	searchKey: mailSearchKey,
} = useMailCommandPaletteSearch(query, mailSearchActive)
const showFilters = ref(false)
const calendarSearchActive = computed(() => activeApp.value === 'calendar')
const hasFilterPanel = computed(() => mailSearchActive.value || calendarSearchActive.value)
const {
	filter: calendarFilter,
	badges: calendarFilterBadges,
	params: calendarFilterParams,
	isNarrowed: calendarIsNarrowed,
	removeFilter: removeCalendarFilter,
	reset: resetCalendarFilters,
} = useCalendarSearchFilters()
// Reached for only once the calendar is the app in view, which is the only time its panel is
// on screen — the store is the calendar app's, and the shell outlives every app in it.
let calendarUser: ReturnType<typeof calendarUserStore> | undefined
const calendarFilterOptions = computed(() =>
	calendarSearchActive.value ? ((calendarUser ??= calendarUserStore()).calendarOptions ?? []) : []
)
/**
 * The field a badge sent the reader to, held only while the panel opens on it: cleared as the
 * panel goes, so raising it again from the sliders button starts where it always did.
 */
const calendarFilterToEdit = ref('')

const editCalendarFilter = (key: string) => {
	calendarFilterToEdit.value = key
	showFilters.value = true
}

watch(showFilters, (open) => {
	if (!open) calendarFilterToEdit.value = ''
})

const calendarBadges = computed(() =>
	calendarFilterBadges(
		(value) => calendarFilterOptions.value.find((o) => o.value === value)?.label || value
	)
)
// A calendar filter narrows on its own, so it is a search whether or not anything was typed.
const calendarFilterAsked = computed(
	() => calendarSearchActive.value && calendarIsNarrowed.value
)
// Whether Enter, with no row to open, still has a search to run: something asked, and the results
// — not the filter panel — on screen to run it from.
const mailSearchAsked = computed(
	() =>
		mailSearchActive.value &&
		!showFilters.value &&
		Boolean(normalizedQuery.value || mailAppliedFilters.value.length)
)
// The panel edits the filters the palette holds; anything still typed as an operator on the query
// line moves across as it opens, so the two never disagree about what is being searched.
const mailPanelFilters = computed({
	get: () => mailFilterValues.value,
	set: (filters: Record<string, string>) => setMailFilters(filters),
})

// Going back to the query line — clicking it, or typing into it — asks for the search, not for more
// of the form: the panel gets out of the way rather than leaving the results it is covering
// unreachable. The click is watched as `mousedown` rather than focus, because the input keeps focus
// the whole time the panel is up (the filters button takes none); the typing is watched as the
// native `input` event, which a paste and an IME both raise and the panel's own rewrite of the
// query — operators moving into the fields as it opens — does not.
// Whatever the query line was just given, the caret goes to its value — selected where there is
// one to replace, waiting where the operator is still empty.
async function selectInPaletteInput(selection: {
	start: number
	end: number
}) {
	await nextTick()
	const input = paletteInputEl()
	if (!input) return
	input.focus()
	input.setSelectionRange(selection.start, selection.end)
}

const mailFilterVerb = (key: string) =>
	canInvertMailFilter(key) ? 'Invert' : 'Edit'
function activateMailFilter(key: string) {
	if (canInvertMailFilter(key)) invertMailFilter(key)
	else void editMailFilter(key)
}

// The value of the token that just came back is selected, not merely pointed at: the filter is
// there to be changed, and typing over it is the quickest way to say what to instead.
async function editMailFilter(key: string) {
	const selection = editMailFilterValue(key)
	if (selection) await selectInPaletteInput(selection)
}

function toggleFilters() {
	showFilters.value = !showFilters.value
	if (showFilters.value) absorbMailQueryFilters()
}

// One object for the life of the palette: the list tracks its active item by value identity, and a
// fresh object per keystroke would drop the highlight while you type. The label is read separately.
const mailSearchPageItem: MailSearchPageItem = {
	resultType: 'mail-search-page',
}
const mailSearchPageLabel = computed(() => {
	const text = query.value.trim()
	return text ? `See all results for "${text}"` : 'See all results for these filters'
})
let openSelectionInNewTab = false

// What the palette opens on, when a shortcut opens it with a line already begun. Read once by
// the open watcher, after it has cleared the line, so a shortcut's `>` survives the clearing.
let openingQuery = ''

useKeyboardShortcut([
	{
		combo: 'Mod+K',
		description: 'Search Suite',
		group: 'Suite',
		allowInInput: true,
		handler: () => {
			root.paletteOpen = true
		},
	},
	{
		// The key the palette's own footer names for switching apps, made to work from the
		// page as well: `>` typed anywhere opens the palette with the `>` already on the line.
		combo: 'Shift+Period',
		description: 'Switch apps',
		group: 'Suite',
		enabled: () => !mailSearchOnly.value,
		handler: () => {
			openingQuery = '>'
			root.paletteOpen = true
		},
	},
])

// The query the results on screen answer. Recorded when an answer arrives rather than when a
// request stops loading: aborting the previous request on each keystroke stops its loading too,
// and reading that as an answer is what made the list claim "No results" mid-word.
const settledQuery = ref('')
// What was asked of the calendar beyond the words, since a filter is a question on its own: with
// nothing typed, the query alone never changes, and a search set running by a filter would have
// looked answered from the moment it was asked.
const calendarAsked = computed(() => JSON.stringify(calendarFilterParams.value))
const settledCalendarFilters = ref(calendarAsked.value)
const settleSearch = () => {
	settledQuery.value = query.value
	settledCalendarFilters.value = calendarAsked.value
}
// Every app's search is asked the same way: on demand, debounced, and settling the query it
// answered however it lands.
const appSearch = (method: 'GET' | 'POST', url: string) =>
	createResource({
		auto: false,
		method,
		url,
		debounce: 180,
		onSuccess: settleSearch,
		onError: settleSearch,
	})

const driveSearch = appSearch('POST', 'suite.drive.api.files.search')
const sheetSearch = appSearch('POST', 'suite.sheets.api.list_sheets')
const slideSearch = appSearch('GET', 'suite.drive.api.list.files')
const writerSearch = appSearch('GET', 'suite.writer.api.general.search')
const meetSearch = appSearch('POST', 'frappe.client.get_list')
// Shared-aware, like the grid's own fetch: a calendar shared with the reader lives in its
// owner's account, so a search of the route's account alone cannot see what the grid is
// drawing from it.
const calendarSearch = appSearch(
	'POST',
	'suite.calendar.api.search_calendar_events_with_shared'
)
const normalizedQuery = computed(() => query.value.trim().toLowerCase())
// What a row is marked by: the words asked, which for mail are the query line less its
// operators — `is:unread` narrows the search and is not a word any subject holds.
const searchWords = computed(() => query.value.trim())
const mailSearchWords = computed(() => parseMailSearchQuery(query.value.trim()).text ?? '')
const appQuery = computed(() =>
	normalizedQuery.value.replace(/^>\s*/, '').trim()
)
const driveResults = computed<DriveResult[]>(() =>
	activeApp.value === 'drive' && Array.isArray(driveSearch.data)
		? driveSearch.data.slice(0, 20)
		: []
)
const sheetResults = computed<SheetResult[]>(() => {
	if (activeApp.value !== 'sheets' || !Array.isArray(sheetSearch.data?.sheets))
		return []
	return sheetSearch.data.sheets
		.slice(0, 20)
		.map((sheet: Omit<SheetResult, 'resultType'>) => ({
			...sheet,
			resultType: 'sheet' as const,
			content_doctype: 'Sheet' as const,
			file_type: 'Spreadsheet' as const,
		}))
})
const slideResults = computed<SlideResult[]>(() => {
	if (activeApp.value !== 'slides' || !Array.isArray(slideSearch.data?.rows))
		return []
	return slideSearch.data.rows
		.filter((row: SlideResult) => row.content_docname)
		.slice(0, 20)
		.map((row: Omit<SlideResult, 'resultType'>) => ({
			...row,
			resultType: 'slide' as const,
		}))
})
const writerResults = computed<WriterResult[]>(() => {
	if (
		activeApp.value !== 'writer' ||
		!Array.isArray(writerSearch.data?.results)
	)
		return []
	return writerSearch.data.results
		.slice(0, 20)
		.map((document: Omit<WriterResult, 'resultType'>) => ({
			...document,
			resultType: 'writer' as const,
			content_doctype: 'Writer Document' as const,
			file_type: 'Document' as const,
		}))
})
const meetResults = computed<MeetResult[]>(() => {
	if (activeApp.value !== 'meet' || !Array.isArray(meetSearch.data)) return []
	return meetSearch.data
		.slice(0, 20)
		.map((meeting: Omit<MeetResult, 'resultType'>) => ({
			...meeting,
			resultType: 'meeting' as const,
		}))
})
const calendarResults = computed<CalendarSearchResultItem[]>(() => {
	if (activeApp.value !== 'calendar' || !Array.isArray(calendarSearch.data))
		return []
	return calendarSearch.data.map((event: Omit<CalendarSearchResultItem, 'resultType'>) => ({
			...event,
			resultType: 'calendar-event' as const,
		}))
})
const minimumQuery = computed(() =>
	calendarSearchActive.value ? calendarMinimumQueryLength : minimumQueryLength
)

/**
 * Whether anything else is on screen for the results to be told apart from — the commands
 * matching the same words, or the contacts and filters mail offers above its hits.
 */
const hasOtherSections = computed(
	() => filteredCommands.value.length > 0 || mailSuggestions.value.length > 0
)

/**
 * A heading over the results, but only where there is a second section under the same query.
 * On its own it would name the app the reader is already in and is already searching.
 */
const resultsLabel = (label: string) => (hasOtherSections.value ? label : undefined)

const contextSearchLabel = computed(
	() =>
		({
			drive: 'Drive',
			sheets: 'Sheets',
			slides: 'Slides',
			writer: 'Writer',
			meet: 'Meet',
			mail: 'Mail',
			calendar: 'Calendar',
		}[activeApp.value])
)
const palettePlaceholder = computed(() =>
	navigationMode.value
		? 'Switch apps'
		: `Search in ${contextSearchLabel.value || 'Suite'}`
)
const apps = computed(() =>
	getAppSwitcherItems(String(route.meta.appId ?? ''), true)
)
const filteredApps = computed(() => {
	if (mailSearchActive.value && mailAppliedFilters.value.length) return []
	if (!appQuery.value) return apps.value
	return apps.value.filter((app) =>
		`${app.title} ${app.name}`.toLowerCase().includes(appQuery.value)
	)
})
const exactApps = computed(() =>
	appQuery.value
		? filteredApps.value.filter(
				(app) =>
					app.title.toLowerCase() === appQuery.value ||
					app.name.toLowerCase() === appQuery.value
		  )
		: []
)
const remainingApps = computed(() =>
	filteredApps.value.filter((app) => !exactApps.value.includes(app))
)
const filteredCommands = computed(() => {
	if (
		navigationMode.value ||
		mailSearchOnly.value ||
		(mailSearchActive.value && mailAppliedFilters.value.length)
	)
		return []
	const commands = root.paletteGroups.flatMap((group) => group.commands)
	return commands
		.filter(
			(command) =>
				!normalizedQuery.value ||
				[command.label, command.description, ...(command.keywords ?? [])]
					.filter(Boolean)
					.join(' ')
					.toLowerCase()
					.includes(normalizedQuery.value)
		)
		.sort((a, b) => commandRank(a) - commandRank(b))
})

function commandRank(command: PaletteCommand) {
	if (/-(new|create|compose|start|schedule|upload)(-|$)/.test(command.id))
		return 0
	if (command.id.includes('settings') || command.id.includes('theme')) return 2
	return 1
}

function enterHint(item: unknown) {
	if (!item || typeof item !== 'object')
		return mailSearchAsked.value ? 'to see all results' : 'to open'
	if ('id' in item) {
		item = filteredCommands.value.find((command) => command.id === item.id) ?? item
	}
	if ('resultType' in item) {
		if (item.resultType === 'mail') return 'to view thread'
		if (item.resultType === 'mail-search-page') return 'to see all results'
		if (item.resultType === 'mail-contact') return 'to choose contact'
		if (item.resultType === 'mail-filter-suggestion') return 'to apply filter'
		if (item.resultType === 'sheet') return 'to open sheet'
		if (item.resultType === 'slide') return 'to open presentation'
		if (item.resultType === 'writer') return 'to open document'
		if (item.resultType === 'meeting') return 'to open meeting'
		if (item.resultType === 'calendar-event') return 'to view event'
	}
	if ('run' in item) {
		const label = 'label' in item ? String(item.label) : 'command'
		if ('enterHint' in item && item.enterHint)
			return `to ${String(item.enterHint)}`
		return `to run ${label}`
	}
	if ('route' in item)
		return `to switch to ${'title' in item ? String(item.title) : 'app'}`
	if ('is_folder' in item && item.is_folder) return 'to open folder'
	if ('content_doctype' in item) {
		if (item.content_doctype === 'Presentation') return 'to open presentation'
		if (item.content_doctype === 'Sheet') return 'to open sheet'
		if (item.content_doctype === 'Writer Document') return 'to open document'
	}
	return 'to open file'
}

// The search as it stands, as a route query: the search page's, and each result's.
const mailSearchQuery = computed(() => ({
	...mailFilter.value,
	...(mailSearchesAllAccounts.value ? { all_accounts: '1' } : {}),
}))
const mailSearchLocation = (): RouteLocationRaw =>
	mailSearchRoute(userStore().accountId, mailSearchQuery.value)

async function applyMailQuickFilter(option: MailFilterOption) {
	if (option.value) {
		applyMailFilter(option.key, option.value)
		return
	}
	if (!option.operator) return
	await selectInPaletteInput(useMailOperator(option.operator))
}

watch(
	[
		driveResults,
		sheetResults,
		slideResults,
		writerResults,
		meetResults,
		calendarResults,
		mailResults,
		mailSuggestions,
	],
	async (groups) => {
		// Not on a phone: a highlighted row there reads as a selection nobody made, and the arrow
		// keys it exists for are not on the screen.
		if (
			!root.paletteOpen ||
			mailSearchOnly.value ||
			!groups.some((items) => items.length)
		)
			return
		await nextTick()
		const input = paletteInputEl()
		if (!input) return
		const activeItem = paletteInput.value?.$el
			.closest('[data-slot="command-palette"]')
			?.querySelector('[data-slot="command-palette-item"][data-state="active"]')
		if (activeItem) return
		input.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Home', bubbles: true })
		)
	},
	{ flush: 'post' }
)

watch(
	[query, mailAppliedFilters, mailAllAccounts, showFilters, calendarFilterParams],
	([value]) => {
		// Nothing to search for while the filter panel is up: its results are not on screen, every
		// keystroke in a field would ask for a set nobody is reading — and nothing is in flight to
		// cancel, since opening the panel already did.
		if (hasFilterPanel.value && showFilters.value) return
		const text = value.trim()
		cancelSearches()
		// Nothing on the server answers "which app": the list is already here.
		if (navigationMode.value) {
			resetSearches()
			return
		}

		if (mailSearchActive.value) {
			searchMail(value, userStore().accountId)
			return
		}

		// A filter narrows on its own, so the calendar can answer a search with no words in it —
		// "everything on the holidays calendar in July" is a question. Every other app needs
		// something typed before there is anything to ask.
		if (
			text.length < minimumQuery.value &&
			!(calendarSearchActive.value && calendarIsNarrowed.value)
		) {
			resetSearches()
			return
		}

		if (activeApp.value === 'drive') {
			driveSearch.submit({ query: text })
		} else if (activeApp.value === 'sheets') {
			sheetSearch.submit({
				start: 0,
				limit: 20,
				search: text,
				owner_filter: 'all',
				order_by: 'modified',
				sort_dir: 'desc',
			})
		} else if (activeApp.value === 'slides') {
			slideSearch.submit({
				search: text,
				file_kinds: JSON.stringify(['Presentation']),
				order_by: 'modified',
				ascending: false,
				start: 0,
				limit: 20,
				paginated: true,
			})
		} else if (activeApp.value === 'writer') {
			writerSearch.submit({ query: text })
		} else if (activeApp.value === 'meet') {
			meetSearch.submit({
				doctype: 'Meet Room',
				fields: ['name', 'title', 'modified'],
				or_filters: [
					['Meet Room', 'title', 'like', `%${text}%`],
					['Meet Room', 'name', 'like', `%${text}%`],
				],
				order_by: 'modified desc',
				limit_page_length: 20,
			})
		} else if (calendarSearchActive.value) {
			calendarSearch.submit({
				account: String(route.params.accountId || ''),
				text,
				limit: CALENDAR_RESULT_LIMIT,
				time_zone: dayjs.tz.guess(),
				filters: calendarFilterParams.value,
			})
		}
	}
)

watch(
	() => root.paletteOpen,
	(open) => {
		if (!open) return

		// Emptied as it opens rather than as it closes: clearing on the way out is a change the
		// closing animation is still on screen to show, so the palette was seen throwing away the
		// search before it went.
		showFilters.value = false
		query.value = ''
		mailAppliedFilters.value = []
		resetCalendarFilters()
		resetSearches()

		if (['drive', 'slides', 'sheets', 'writer'].includes(activeApp.value))
			getRecents.reload()
		if (isMailSearchRoute.value) {
			query.value = typeof route.query.text === 'string' ? route.query.text : ''
			// The search being edited says what it searched, so it wins over the remembered
			// preference for as long as the palette is reopened on top of it.
			mailAllAccounts.value = route.query.all_accounts != null
			setMailFilters(
				Object.fromEntries(
					Object.entries(route.query).filter(
						([key, value]) =>
							key !== 'text' &&
							key !== 'all_accounts' &&
							typeof value === 'string'
					)
				) as Record<string, string>
			)
		}
		if (openingQuery) {
			query.value = openingQuery
			openingQuery = ''
			// The caret after it, not the text selected: the dialog's focus scope selects an
			// input's text as it focuses it, and a selected `>` is one the next key replaces.
			// The scope leaves an input that is already focused alone, so focusing it here
			// first keeps the selection off whichever of the two runs first.
			nextTick(() => {
				const input = paletteInputEl()
				if (!input) return
				input.focus()
				input.setSelectionRange(input.value.length, input.value.length)
			})
		}
	}
)

// Asked but not yet answered — the debounce it is waiting out included, which is exactly when an
// empty list means "not yet" rather than "nothing".
const isSearching = computed(() => {
	if (mailSearchActive.value) return mailSearchPending.value
	if (settledQuery.value !== query.value) return true
	return calendarSearchActive.value && settledCalendarFilters.value !== calendarAsked.value
})

// Said in one place and in the order the reader needs it: what mode you are in, what the operator
// you are halfway through wants, whether there is even enough to search on, whether the answer is
// still coming — and only then that there is nothing.
const emptyMessage = computed(() => {
	const text = query.value.trim()
	if (navigationMode.value) return `No app matches "${appQuery.value}"`
	if (mailOperatorContext.value) return mailOperatorContext.value.prompt
	if (
		!mailSearchActive.value &&
		text &&
		text.length < minimumQuery.value &&
		contextSearchLabel.value
	)
		return `Type more to search ${contextSearchLabel.value}`
	if (isSearching.value) return 'Searching…'
	if (mailAppliedFilters.value.length) return 'No mail matches these filters'
	// A filter-only search has no words to quote back, so it names the filters instead.
	if (calendarFilterAsked.value && !text) return 'No events match these filters'
	return `No results for "${text}"`
})

function resetSearches() {
	// Nothing was asked, so nothing is outstanding: the query is as answered as it is going to be.
	settleSearch()
	cancelSearches()
	for (const resource of [
		driveSearch,
		sheetSearch,
		slideSearch,
		writerSearch,
		meetSearch,
		calendarSearch,
	]) {
		resource.reset()
	}
	resetMailSearch()
}

function cancelSearches() {
	for (const resource of [
		driveSearch,
		sheetSearch,
		slideSearch,
		writerSearch,
		meetSearch,
		calendarSearch,
	]) {
		resource.submit.cancel()
		resource.abort()
	}
	cancelMailSearch()
}

function handleMailFilterBackspace(event: KeyboardEvent) {
	if (
		query.value ||
		!mailAppliedFilters.value.length ||
		(!event.metaKey && !event.ctrlKey)
	)
		return
	event.preventDefault()
	mailAppliedFilters.value = mailAppliedFilters.value.slice(0, -1)
}

function handlePaletteEnter(event: KeyboardEvent) {
	if (event.key !== 'Enter') return
	// The listbox still highlights its first row as you type on a phone — that is reka's, not
	// ours — but the page hides it, and Enter must not open a row nobody can see is chosen.
	const activeItem = mailSearchOnly.value
		? null
		: (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
				'[data-slot="command-palette-item"][data-state="active"]'
		  )

	// Held, Enter opens the highlighted row in a new tab.
	if (event.metaKey || event.ctrlKey) {
		if (!activeItem) return
		event.preventDefault()
		event.stopPropagation()
		openSelectionInNewTab = true
		activeItem.click()
		return
	}

	// Nothing highlighted, so there is no row for Enter to open — but in mail it still means
	// "search for this", and the results page is where that answer lives however few rows came
	// back here. Left alone while the filter panel is up: Enter belongs to the field you are in.
	if (activeItem || !mailSearchAsked.value) return
	event.preventDefault()
	event.stopPropagation()
	void openMailSearchPage()
}

// On a phone the palette is opened on top of a search route pushed to host it, so the results
// replace that entry rather than stacking on it: pushing left an empty "Search your mail" page
// between the results and the folder they were searched from, which is what Back landed on.
async function goToMailSearch() {
	rememberMailSearch()
	const location = mailSearchLocation()
	if (isMobile.value && isMailSearchRoute.value) await router.replace(location)
	else await router.push(location)
}

// Back from the editor goes to what is worth standing on. Over results, that is the results:
// the editor closes and the page's own header takes this row's place, a search icon and the
// query as it stands. Over an empty search page there is nothing to return to, so it leaves
// search altogether — the route that hosted the editor goes with it, back to the folder it was
// opened from, or to the inbox when there is no folder behind it.
function leaveMobileSearch() {
	// Closed first either way, so the fade starts from here rather than from whichever watcher
	// notices the route has gone.
	root.paletteOpen = false
	if (mailHasSearchQuery.value) return
	if (window.history.state?.back) history.back()
	else router.replace('/mail')
}

async function openMailSearchPage() {
	await goToMailSearch()
	root.paletteOpen = false
}

async function selectItem(item: PaletteItem, event: CommandPaletteSelectEvent) {
	const originalEvent = event.detail.originalEvent
	const openInNewTab =
		openSelectionInNewTab || originalEvent.metaKey || originalEvent.ctrlKey
	openSelectionInNewTab = false
	if ('resultType' in item && item.resultType === 'mail-contact') {
		event.preventDefault()
		selectMailContact(item)
		return
	}
	if ('resultType' in item && item.resultType === 'mail-filter-suggestion') {
		event.preventDefault()
		selectMailFilterSuggestion(item)
		return
	}
	if ('resultType' in item && item.resultType === 'mail-recent-search') {
		event.preventDefault()
		restoreMailSearch(item)
		return
	}
	if ('resultType' in item && item.resultType === 'mail-search-page') {
		if (openInNewTab) {
			window.open(
				router.resolve(mailSearchLocation()).href,
				'_blank',
				'noopener'
			)
			return
		}
		await goToMailSearch()
		return
	}
	if ('run' in item) {
		if (item.keepOpen) event.preventDefault()
		await item.run({ query: query.value })
		return
	}
	if ('route' in item) {
		if (openInNewTab) {
			window.open(item.route, '_blank', 'noopener')
			return
		}
		if (!item.spa) {
			window.location.assign(item.route)
			return
		}
		await router.push(item.route)
		return
	}
	if ('resultType' in item) {
		let location: RouteLocationRaw
		if (item.resultType === 'sheet') {
			location = { name: 'sheets-editor', params: { id: item.name } }
		} else if (item.resultType === 'slide') {
			location = {
				name: 'slides-editor',
				params: { presentationId: item.content_docname },
				query: { slide: 1 },
			}
		} else if (item.resultType === 'writer') {
			location = { name: 'writer-document', params: { id: item.name } }
		} else if (item.resultType === 'mail') {
			rememberMailSearch()
			location = {
				name: 'mail-mail',
				params: {
					accountId: item.account,
					mailbox: 'search',
					threadID: item.thread_id,
				},
				query: mailSearchQuery.value,
			}
		} else if (item.resultType === 'calendar-event') {
			const start = eventStartLocal(item)
			// The view the reader is in is the view the result opens in — Agenda included.
			// Left out, it fell through to the fallback, and searching from Agenda landed
			// on a month grid nobody asked for.
			const calendarRoute = [
				'calendar-month',
				'calendar-week',
				'calendar-day',
				'calendar-agenda',
			].includes(String(route.name))
				? String(route.name)
				: 'calendar-month'
			location = {
				name: calendarRoute,
				params: {
					// The reader's own account, not the event's: a hit on a shared calendar
					// belongs to whoever owns it, and routing there would switch the calendar
					// to an account nobody thinks of as theirs. The grid shows the shared
					// event inside the reader's view, and so does the link to it — which is
					// what `account` is for, ids being unique only within an account.
					accountId: route.params.accountId || item.account,
					year: start.year(),
					month: start.month() + 1,
					day: start.date(),
				},
				query: {
					event: item.master_id || item.id,
					recurrence: item.recurrence_id || undefined,
					account: item.account || undefined,
				},
			}
		} else {
			location = { name: 'meet-meeting', params: { meetingId: item.name } }
		}
		const href = router.resolve(location).href
		if (openInNewTab) {
			window.open(href, '_blank', 'noopener')
		} else {
			await router.push(location)
		}
		return
	}

	const { openEntity } = await import('@/apps/drive/utils/files')
	openEntity(item, openInNewTab)
}

onScopeDispose(() => {
	resetSearches()
})
</script>

<style>
.palette-command-shortcut [data-slot='key'] {
	height: 1.25rem;
	min-width: 1.25rem;
	padding-inline: 0.25rem;
}

[data-slot='command-palette-item'][data-state='active']
	.palette-command-shortcut
	[data-slot='key'] {
	background-color: var(--surface-base);
}

/* The filter row already puts its own padding between the chips and what follows. The list's
   first group adds its top margin on top of that, and the two together read as a hole under the
   chips — twice the space that sits above them. */
.mail-search-filters
	+ [data-slot='command-palette-list']
	> [data-slot='command-palette-group']:first-child {
	margin-top: 0;
}

/* Higher than the dialog's own `position="top"` puts it (20vh): a palette is reached for from the
   keyboard and read from the top down, and a fifth of the screen above it was dead space. The
   palette forwards no `paddingTop` to its Dialog, so the wrapper is restyled here — on desktop
   only; the phone's page mode zeroes this padding itself below. */
@media (min-width: 768px) {
	[data-position='top']:has(> .dialog-content > [data-slot='command-palette']) {
		padding-top: 16vh;
	}
}

@media (max-width: 767px) {
	/* Hidden, not removed. The dialog fires `after-leave` — which the palette answers by
	   clearing the query — when the overlay's exit animation ends, and an overlay that is not
	   displayed has no animation to end: the query was wiped the instant close began, so the
	   text vanished behind a still-opaque panel and came back as the page showed through. An
	   invisible overlay still animates for its 150ms, so the reset waits for the fade. */
	.dialog-overlay:has(+ .dialog-scroll-container .mail-mobile-search-page) {
		visibility: hidden;
	}

	/* The whole screen, not the screen above the tab bar: the strip left for the bar showed the
	   search page behind this one — its "Search your mail" over this one's own empty state. The
	   way out is the back arrow in the query line, which is where a thumb already is. */
	.dialog-scroll-container:has(.mail-mobile-search-page) {
		bottom: 0;
		overflow: hidden;
	}

	/* A definite height, not a minimum: the page below fills what it is given, and a
	   percentage height inside a min-height box is given nothing — the editor stopped at
	   its own content and the search page showed through below it. */
	.dialog-scroll-container:has(.mail-mobile-search-page) > div {
		height: 100%;
		align-items: stretch;
		padding: env(safe-area-inset-top) 0 0;
	}

	.dialog-content:has(> .mail-mobile-search-page) {
		height: 100%;
		max-width: none;
		margin: 0;
		border-radius: 0;
		background-color: var(--surface-base);
		box-shadow: none;
	}

	.mail-mobile-search-page {
		height: 100%;
		max-height: none;
		background-color: var(--surface-base);
	}

	/* A fade and nothing else. The dialog's own animation shrinks to 98% and stops at half
	   opacity, leaving the overlay to finish the dimming — but this page has no overlay, so
	   the editor drifted and half-faded, then vanished, and the search page's identical row
	   beneath snapped to full strength. Fading all the way, in place, the two rows cross into
	   each other and only the body appears to come and go. */
	.dialog-content:has(> .mail-mobile-search-page)[data-state='open'] {
		animation: mail-search-page-in 100ms ease-out;
	}

	.dialog-content:has(> .mail-mobile-search-page)[data-state='closed'] {
		animation: mail-search-page-in 150ms ease-in reverse;
	}

	@keyframes mail-search-page-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* A flat 56px — the height every mobile header in the product stands at (see mail's
	   MobileTitleHeader and the calendar's search page) — rather than a row that is whatever
	   its padding adds up to. It used to be 16px of padding either side of 14px type, which
	   came to 48 and left this the one row on a phone 8px shorter than its neighbours. The
	   search page's own header is the same 56px, so dismissing the editor onto it still swaps
	   the row rather than resizing it.

	   Horizontally, the calendar's search header: a 12px gutter, the icon, then 20px to the
	   text — its row's gap-2 plus the 12px the forms plugin gives a bare input. The library's
	   field here has px-0, so that 12px is set on it below, and the results page's header
	   keeps the same three measures so the swap holds sideways as well as down. */
	.mail-mobile-search-page [data-slot='command-palette-input'] {
		gap: 8px;
		padding-inline: 12px;
		height: 56px;
	}

	/* The field fills the row it sits in rather than being the sum of its own padding: with the
	   row's height set above, the padding would stand the text off-centre, and a field only as
	   tall as its text would leave the top and bottom of a 56px row dead to a thumb. Stretched,
	   the whole row is the tap target and the input centres its text itself. */
	.mail-mobile-search-page [data-slot='command-palette-input'] input {
		padding-block: 0;
		padding-inline: 12px;
		align-self: stretch;
	}

	/* The chips, by name rather than by position: `:not(:last-child)` was meant to spare the
	   clear-all ×, but that is the last child only while filters are applied — otherwise the
	   last chip was the one left small, and reordering moved which chip that was. */
	/* `!important`, because the chip's own `!h-7` is one too: a leading `!` on a utility
	   emits it, and a plain 32px here lost to that 28px — so the text below was already 14px
	   inside a chip that never grew to hold it, which is the cramped chip this rule existed
	   to prevent. */
	.mail-mobile-search-page .mail-search-filters > span,
	.mail-mobile-search-page .mail-search-filters > button:not(.mail-search-clear) {
		height: 32px !important;
		font-size: 14px;
	}

	/* A phone's list, not a desktop dialog's. Rows sit on the px-5 axis mail's mobile title
	   header names for list content, and stand 10px tall each side — the agenda's own row
	   height when narrow. The palette's mx-2.5 px-2 py-2 is the density of a dialog under a
	   query line and read as cramped here; 12px, the calendar search page's number, was
	   chosen for two-line rows behind a chip, and between one-line rows it read as gaps.
	   The chip row and the group labels sit on the same axis, so the page has one left edge
	   rather than three. */
	.mail-mobile-search-page [data-slot='command-palette-item'] {
		margin-inline: 0;
		padding: 10px 20px;
	}

	.mail-mobile-search-page [data-slot='command-palette-group-label'] {
		padding-inline: 20px;
	}

	.mail-mobile-search-page .mail-search-filters {
		gap: 8px;
		padding: 12px 20px;
	}

	.mail-mobile-search-page [data-slot='command-palette-footer'] {
		display: none;
	}

	/* No highlighted row. The listbox highlights its first row as you type and there is no
	   prop to stop it, so the styling is stopped instead: on a phone the highlight can only
	   be read as a selection, and nothing there can move it. */
	.mail-mobile-search-page [data-slot='command-palette-item'][data-state='active'] {
		background-color: transparent;
	}

	/* The press, though: a finger on a row gets the ground a pointer's hover gives it, for
	   as long as it is down. Keyed on `:active` — the press itself — rather than the
	   listbox's own highlight above, which on a phone is a selection with nothing to move it. */
	.mail-mobile-search-page [data-slot='command-palette-item']:active {
		background-color: var(--surface-gray-2);
	}
}
</style>
