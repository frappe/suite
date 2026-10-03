<!--
  The mobile bottom sheet's content: whichever app panel the desktop shows in
  its own second column. Both sides render the same components, so the phone
  and the desktop can never drift apart.

  Mail's account switcher is pinned above the scroll area for the same reason
  it is on desktop: its card opens downwards over the list, and a scroll
  container would clip it.
-->
<template>
  <div v-if="area === 'mail'" class="relative z-20 shrink-0 px-2 pt-2">
    <MailAccountSwitcher />
  </div>

  <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-0.5 pb-10">
    <MailPanel v-if="area === 'mail'" />
    <CalendarPanel v-else-if="area === 'calendar'" />
    <FilesPanel v-else />
  </ScrollArea>
</template>

<script setup lang="ts">
import { ScrollArea } from 'frappe-ui'

import { useShellNav } from '../useShellNav'
import MailAccountSwitcher from './MailAccountSwitcher.vue'
import CalendarPanel from './panels/CalendarPanel.vue'
import FilesPanel from './panels/FilesPanel.vue'
import MailPanel from './panels/MailPanel.vue'

const { area } = useShellNav()
</script>
