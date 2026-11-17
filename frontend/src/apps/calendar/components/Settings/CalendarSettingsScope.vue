<!--
  Gives a Calendar settings tab the injections CalendarLayout gives Calendar
  pages, so the tab also works in the Suite Settings dialog outside Calendar.
  Until the user info is in, it shows the tab's header and the settings
  loading state, where the tab will put them, or the load failure. The slot
  gets the active account, so the tab can be rebuilt for each account.
-->
<template>
  <slot v-if="userResource.data" :account="store.accountId" />
  <SettingsPage v-else loading :reads="[userResource]" />
</template>

<script setup lang="ts">
import { provide } from 'vue'

import { userStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import { SettingsPage } from '@/platform/settings-tab'

defineSlots<{ default?: (props: { account: string }) => unknown }>()

const store = userStore()
const { userResource } = store
provide('$user', userResource)
provide('$dayjs', dayjs)
</script>
