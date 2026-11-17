<!--
  Gives a Calendar settings tab the injections CalendarLayout gives Calendar
  pages, so the tab also works in the Suite Settings dialog outside Calendar.
  Until the user info is in, it shows the tab's header and the settings
  loading state, where the tab will put them, or the load failure.
-->
<template>
  <slot v-if="userResource.data" />
  <SettingsPage v-else loading :reads="[userResource]" />
</template>

<script setup lang="ts">
import { provide } from 'vue'

import { userStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import { SettingsPage } from '@/platform/settings-tab'

defineSlots<{ default?: () => unknown }>()

const { userResource } = userStore()
provide('$user', userResource)
provide('$dayjs', dayjs)
</script>
