<script setup lang="ts">
import { useNow, useStorage } from '@vueuse/core'
import { Button, SidebarItem, SidebarSection, Tooltip } from 'frappe-ui'
import { Ellipsis, Plus } from 'lucide-vue-next'
import { computed, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import MiniMonth from '@/apps/calendar/components/MiniMonth.vue'
import CalendarModal from '@/apps/calendar/components/Modals/CalendarModal.vue'
import DeleteCalendarModal from '@/apps/calendar/components/Modals/DeleteCalendarModal.vue'
import UpcomingEvents from '@/apps/calendar/components/UpcomingEvents.vue'
import { useCalendarActions } from '@/apps/calendar/composables/useCalendarActions'
import { userStore } from '@/apps/calendar/stores/user'
import type { CalendarRow } from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'
import dayjs from '@/apps/calendar/utils/dayjs'
import { toTitleCase } from '@/apps/calendar/utils/format'
import {
  MOBILE_VIEWS,
  routeDate,
  routeForView,
  viewForRoute,
  viewIcon,
  viewLabel,
  type MobileView,
} from '@/apps/calendar/utils/mobileView'
import { accountSubmenu, AreaSidebar, AreaSidebarFooter } from '@/platform/area-sidebar'
import { Dropdown } from '@/platform/feedback'

const { events, selectedEvent, isMobile } = defineProps<{
  /** Whether the page is in its phone layout; the sheet then carries the view switcher. */
  isMobile: boolean
  /** The month the calendar shows; the mini month mirrors it. */
  month?: number
  year?: number
  /** The day it is on, for the mini month's selection. */
  day?: number
  /** Today's events: `fromDate`/`toDate` in the viewer's zone, a palette `color`. */
  events?: any[]
  /** The open event, so its row reads as active. */
  selectedEvent?: any
  /** Palette colour per calendar id, for its dot here and the mini month's. */
  calendarColor: (calendar: string) => string
}>()

const emit = defineEmits<{
  selectDate: [date: Date]
  selectEvent: [event: any, e: MouseEvent]
}>()

const dotStyle = (color: string) => ({ background: eventColor(color) })

// The account's own calendars, then those shared with the user from other accounts. The shared
// section is only there when something is shared.
const calendarGroups = computed(() => {
  const calendars = store.calendars.data ?? []
  const mine = calendars.filter((calendar) => calendar.account === store.accountId)
  const shared = calendars.filter((calendar) => calendar.account !== store.accountId)
  return [
    { key: 'mine', label: __('My Calendars'), calendars: mine },
    ...(shared.length ? [{ key: 'shared', label: __('Shared Calendars'), calendars: shared }] : []),
  ]
})

// Which sections are folded, remembered in this browser.
const collapsedSections = useStorage<string[]>('calendar-collapsed-sections', [])
const setSectionCollapsed = (key: string, collapsed: boolean) =>
  (collapsedSections.value = collapsed
    ? [...collapsedSections.value, key]
    : collapsedSections.value.filter((k) => k !== key))

/** A shared calendar's owner, for its tooltip. */
const ownerName = (calendar: CalendarRow) =>
  calendar.account === store.accountId
    ? ''
    : (user.data.all_accounts.find((a) => a.id === calendar.account)?._name ?? '')

// A JMAP calendar is often named after its account — "Frappe Calendar
// (akash@frappe.io)" — which never fits a sidebar row. The email moves to a
// tooltip; once there are several accounts the colour dot tells them apart.
const calendarLabel = (calendar: any) => {
  const match = /^(.*?)\s*\(([^()]*@[^()]*)\)$/.exec(calendar._name || '')
  return match ? { label: match[1], email: match[2] } : { label: calendar._name, email: '' }
}

// --- Upcoming events: what is left of today, like mail's sidebar shows ---
// The events handed over are today's already; this drops what is over, cancelled
// or declined, and puts the rest in order.

const now = useNow({ interval: 30_000 })

const upcoming = computed(() => {
  const current = dayjs(now.value)
  const today = current.format('YYYY-MM-DD')
  return (
    (events || [])
      .filter((event) => {
        if (event.status === 'Cancelled' || event.isDeclined) return false
        if (event.fromDate > today || event.toDate < today) return false
        // An all-day event covers the whole of today; a timed one is over once its end has passed.
        return event.isAllDay || dayjs(`${event.toDate} ${event.toTime}`).isAfter(current)
      })
      // Sorted on the shape transformEvent hands over — date plus wall clock. An
      // all-day event starts at midnight, so it leads the day on its own.
      .sort((a, b) => `${a.fromDate} ${a.fromTime}`.localeCompare(`${b.fromDate} ${b.fromTime}`))
  )
})

const isOpen = (event: any) =>
  !!selectedEvent &&
  selectedEvent.id === event.id &&
  (selectedEvent.recurrence_id ?? '') === (event.recurrence_id ?? '')

/** The dot beside an upcoming event, in its calendar's colour. */
const eventDotColor = (event: any) => eventColor(event.color)

const route = useRoute()
const router = useRouter()
const store = userStore()

const user = inject('$user')

const subtitle = computed(() => {
  // A user with no personal account and no stored id leaves `accountId` empty,
  // and the find unmatched — as mail's sidebar already allows for.
  const currentAccount = user.data.accounts.find((a) => a.id === store.accountId)
  if (!currentAccount || currentAccount.is_personal) return toTitleCase(user.data.full_name)
  return currentAccount._name
})

const calendarActions = useCalendarActions()
const {
  selected: selectedCalendar,
  showEdit: showCalendarModal,
  showDelete: showDeleteCalendar,
} = calendarActions

// The account menu lists the accounts themselves. With one account there is nothing to pick.
const accountMenu = computed(() =>
  user.data.accounts?.length > 1
    ? accountSubmenu(user.data.accounts, store.accountId, (accountId) =>
        router.push({ name: route.name, params: { ...route.params, accountId } }),
      )
    : [],
)

// --- The phone's view switcher, in the sheet the bottom nav opens ---
// The URL is the source of truth for the view, so switching is a navigation, not
// a flag handed to the view — and Back retraces it, as it does on the desktop.
// The day stays put: the month you open is the one the agenda was on.
const onCalendar = computed(
  () => route.name !== 'calendar-search' && route.name !== 'calendar-profile',
)
const currentView = computed<MobileView>(() => viewForRoute(route.name))
const isCurrentView = (view: MobileView) => onCalendar.value && view === currentView.value

const selectView = (view: MobileView) => {
  if (onCalendar.value && view === currentView.value) return
  const day = routeDate(route.params)
  router.push({
    name: routeForView(view),
    params: {
      accountId: store.accountId,
      year: String(day.year()),
      month: String(day.month() + 1),
      day: String(day.date()),
    },
    query: onCalendar.value ? route.query : {},
  })
}
</script>

<template>
  <!-- Calendar's own sidebar, in the shell's sidebar slot on a desktop and in a sheet on a
	     phone, which the Calendar tab and the header's menu button open. -->
  <AreaSidebar area="calendar" :title="__('Calendar')" :sheet-title="false" sheet-flush>
    <!-- The active account leads. Its menu lists the accounts; with one account it is just
         named. On a phone the accounts are in Profile. -->
    <SidebarSection v-if="!isMobile" class="!mt-0">
      <Dropdown v-if="accountMenu.length" :options="accountMenu" :match-trigger-width="true">
        <SidebarItem :label="subtitle" icon="lucide-circle-user-round">
          <template #suffix>
            <span
              class="lucide-chevrons-up-down mr-2 size-3.5 text-ink-gray-5"
              aria-hidden="true"
            />
          </template>
        </SidebarItem>
      </Dropdown>
      <SidebarItem v-else :label="subtitle" icon="lucide-circle-user-round" />
    </SidebarSection>

    <!-- On a phone, the sheet the Calendar tab and the header's menu button open, as develop's
         was: the views as a row of tiles, a glyph in a square and the name beneath, the square
         solid for the one you are on; a rule; then the calendars, grouped as the sidebar groups
         them. A tap switches a calendar on or off and leaves the sheet up, since one tap is
         rarely the last. -->
    <template v-if="isMobile">
      <div class="grid grid-cols-4 gap-2 pt-1">
        <button
          v-for="view in MOBILE_VIEWS"
          :key="view"
          type="button"
          class="flex flex-col items-center gap-2 rounded-6 py-2 text-center"
          :class="isCurrentView(view) ? 'text-ink-gray-9' : 'text-ink-gray-7'"
          :aria-current="isCurrentView(view) ? 'true' : undefined"
          @click="selectView(view)"
        >
          <span
            class="grid size-12 place-items-center rounded-4"
            :class="
              isCurrentView(view)
                ? 'bg-surface-gray-10 text-ink-base'
                : 'bg-surface-gray-2 active:bg-surface-gray-3'
            "
          >
            <component
              :is="viewIcon(view)"
              class="size-6 shrink-0"
              :class="isCurrentView(view) ? '[stroke-width:1.75]' : '[stroke-width:1.5]'"
            />
          </span>
          <span
            class="text-sm leading-none"
            :class="isCurrentView(view) ? '!font-semibold' : '!font-medium'"
          >
            {{ viewLabel(view) }}
          </span>
        </button>
      </div>
      <div class="-mx-3 mt-3 border-t" />
      <template v-for="group in calendarGroups" :key="group.key">
        <div class="text-ink-gray-5 px-3 pb-1 pt-3 text-sm">{{ group.label }}</div>
        <!-- Rows as Mail's folder sheet spaces them, 2px apart. -->
        <div class="flex flex-col gap-0.5">
          <button
            v-for="calendar in group.calendars"
            :key="calendar.name"
            type="button"
            class="flex w-full items-center gap-3 rounded-6 px-3 py-2.5 text-base text-ink-gray-8 active:bg-surface-gray-1"
            :aria-pressed="!!calendar.visible"
            @click="calendarActions.toggleVisible(calendar)"
          >
            <span class="grid size-[18px] shrink-0 place-items-center">
              <span
                class="size-2.5 rounded-full transition-opacity"
                :class="!calendar.visible && 'opacity-30'"
                :style="dotStyle(calendarColor(calendar.name))"
              />
            </span>
            <span class="flex-1 truncate text-left" :class="!calendar.visible && 'text-ink-gray-4'">
              {{ calendarLabel(calendar).label }}
            </span>
          </button>
        </div>
      </template>
    </template>

    <!-- The month card: where a date gets chosen on a desktop. The phone's
		     header has its own picker. -->
    <div v-if="!isMobile && month != null && year != null" class="my-3">
      <MiniMonth
        :month
        :year
        :calendar-color="calendarColor"
        :selected="day != null ? new Date(year, month, day) : undefined"
        @select="(date) => emit('selectDate', date)"
      />
    </div>
    <template v-if="!isMobile">
      <SidebarSection
        v-for="group in calendarGroups"
        :key="group.key"
        :label="group.label"
        :collapsible="calendarGroups.length > 1"
        :collapsed="collapsedSections.includes(group.key)"
        class="!mt-4"
        @update:collapsed="(collapsed) => setSectionCollapsed(group.key, collapsed)"
      >
        <!-- A calendar that is switched off keeps its place but loses its colour. -->
        <SidebarItem
          v-for="calendar in group.calendars"
          :key="calendar.name"
          :label="calendar._name"
          :on-click="() => calendarActions.toggleVisible(calendar)"
        >
          <template #prefix>
            <!-- One size collapsed and expanded, centred in the 16px icon box. 10px, about
  					     cap height: at 12 a filled dot outweighed the label and the outline + below. -->
            <span class="grid size-4 place-items-center">
              <span
                class="size-2.5 rounded-full transition-opacity"
                :class="!calendar.visible && 'opacity-30'"
                :style="dotStyle(calendarColor(calendar.name))"
              />
            </span>
          </template>
          <Tooltip :text="calendarLabel(calendar).email || ownerName(calendar)" side="right">
            <span class="truncate text-sm" :class="!calendar.visible && 'text-ink-gray-4'">
              {{ calendarLabel(calendar).label }}
            </span>
          </Tooltip>
          <template #suffix>
            <Dropdown
              v-if="calendarActions.hasMenuOptions(calendar)"
              :options="calendarActions.menuOptions(calendar)"
            >
              <Button
                variant="ghost"
                class="!bg-transparent"
                :aria-label="__('Calendar options')"
                @click.stop
              >
                <template #icon>
                  <Ellipsis
                    class="size-4 text-ink-gray-6 opacity-0 group-hover/sidebar-item:opacity-100 group-focus-within/sidebar-item:opacity-100 [@media(hover:none)]:opacity-100"
                  />
                </template>
              </Button>
            </Dropdown>
          </template>
        </SidebarItem>
        <SidebarItem
          v-if="group.key === 'mine'"
          :label="__('New Calendar')"
          :icon="Plus"
          :on-click="calendarActions.create"
        />
      </SidebarSection>
    </template>

    <!-- Pinned under the scrolling body, as mail's sidebar keeps it. -->
    <AreaSidebarFooter v-if="!isMobile">
      <UpcomingEvents
        :events="upcoming"
        :is-collapsed="false"
        :is-open
        :event-color="eventDotColor"
        @select="(event, e) => emit('selectEvent', event, e)"
      />
    </AreaSidebarFooter>
  </AreaSidebar>
  <CalendarModal v-model="showCalendarModal" :calendar="selectedCalendar" />
  <DeleteCalendarModal v-model="showDeleteCalendar" :calendar="selectedCalendar" />
</template>
