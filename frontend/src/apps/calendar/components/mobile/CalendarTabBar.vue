<template>
  <!-- Calendar's own bottom bar on a phone, where Calendar is an app of its own, as Mail's is:
       the view you are on, Search, and your profile. No other apps here: each is its own. -->
  <MobileNav>
    <!-- The tab takes the view's icon and name, as Mail's takes the folder's. Tapped again it
         opens the sheet with the views and the calendars, as Mail's opens its folders. -->
    <MobileNavItem :label="viewLabel(currentView)" :active="onCalendar" @click="openCalendar">
      <component
        :is="viewIcon(currentView)"
        class="size-6"
        :class="onCalendar ? 'text-ink-gray-8' : 'text-ink-gray-5'"
      />
    </MobileNavItem>
    <MobileNavItem :label="__('Search')" :active="searching" @click="openSearch">
      <span
        class="lucide-search size-6"
        :class="searching ? 'text-ink-gray-8' : 'text-ink-gray-5'"
        aria-hidden="true"
      />
    </MobileNavItem>
    <MobileNavItem :label="__('Profile')" :active="onProfile" @click="openProfile">
      <Avatar :image="session.user.value?.avatar ?? undefined" :label="accountLabel" size="md" />
    </MobileNavItem>
  </MobileNav>
</template>

<script setup lang="ts">
import { Avatar, MobileNav, MobileNavItem } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { userStore } from '@/apps/calendar/stores/user'
import { lastCalendarView } from '@/apps/calendar/utils/lastView'
import { routeForView, viewForRoute, viewIcon, viewLabel } from '@/apps/calendar/utils/mobileView'
import { openAreaSidebar } from '@/platform/area-sidebar'
import { useSession } from '@/platform/session'

const route = useRoute()
const router = useRouter()
const session = useSession()
const store = userStore()

const accountLabel = computed(
  () => session.user.value?.fullName || session.user.value?.id || __('Profile'),
)
const searching = computed(() => route.name === 'calendar-search')
const onProfile = computed(() => route.name === 'calendar-profile')
const onCalendar = computed(() => !searching.value && !onProfile.value)

// Off the calendar the tab names the view a tap goes back to: the one it was left in.
const returnRoute = () => lastCalendarView() ?? routeForView('agenda')
const currentView = computed(() => viewForRoute(onCalendar.value ? route.name : returnRoute()))

const openCalendar = () => {
  if (onCalendar.value) return openAreaSidebar('calendar')
  void router.push({ name: returnRoute(), params: { accountId: store.accountId } })
}
const openSearch = () => {
  if (searching.value) return
  void router.push({ name: 'calendar-search', params: { accountId: store.accountId } })
}
const openProfile = () => {
  if (onProfile.value) return
  void router.push({ name: 'calendar-profile', params: { accountId: store.accountId } })
}
</script>
