<!--
  Mail's own panel: where mail arrives, where it is filed, and what it is
  sorted into — three sections in that order.

  The account switcher is not here: it lives in AppSplit's panel-header slot,
  outside this ScrollArea, because its card overlays the list below it and a
  scroll container would clip it.
-->
<template>
  <!-- Search sits above the mailboxes rather than over the thread list: it
       searches all of Mail, so it belongs with the places mail is kept, not
       inside the one list it happens to be filtering. -->
  <div class="pb-[22px]">
    <TextInput v-model="mailSearch" placeholder="Search mail" aria-label="Search mail">
      <template #prefix>
        <span class="lucide-search size-4" aria-hidden="true" />
      </template>
    </TextInput>
  </div>

  <div class="space-y-0.5">
    <MailboxList :items="inboxOnly" />
    <!-- The Screener stands between arrival and the views that cut across it:
         it is a queue of decisions about people, not a place mail is filed. -->
    <!-- Only while screening is on: with it off, new senders land in the
         inbox and there is no queue for this row to lead to. -->
    <ScreenerLink v-if="screenNewSenders" />
    <MailboxList :items="belowScreener" />
  </div>

  <div class="mt-3 flex h-7 items-center">
    <SidebarLabel>Folders</SidebarLabel>
  </div>
  <MailboxList :items="MAIL_SYSTEM_FOLDERS" class="mt-0.5" />
  <div class="mt-0.5">
    <SidebarItem label="New folder" icon="lucide-plus" @click="() => {}" />
  </div>

  <div class="mt-3 flex h-7 items-center">
    <SidebarLabel>Categories</SidebarLabel>
  </div>
  <MailboxList :items="MAIL_CATEGORIES" class="mt-0.5" />
</template>

<script setup lang="ts">
import { SidebarItem, SidebarLabel, TextInput } from 'frappe-ui'

import { MAIL_CATEGORIES, MAIL_PRIMARY, MAIL_SYSTEM_FOLDERS } from '../../mailFixtures'
import { screenNewSenders } from '../../mailSettings'
import { mailSearch } from '../../useMailSearch'
import MailboxList from '../MailboxList.vue'
import ScreenerLink from '../ScreenerLink.vue'

// Split so the Screener can sit between the two, which the list component
// cannot express on its own. Below it: Unread, then Starred — the views that
// read across mailboxes rather than naming one.
const inboxOnly = MAIL_PRIMARY.slice(0, 1)
const belowScreener = MAIL_PRIMARY.slice(1)
</script>
