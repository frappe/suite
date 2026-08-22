<!--
  PROTOTYPE — remove. Mail nav shared by every variant's mail chrome. It draws
  one section — system mailboxes by default, or the user's own folders when
  they are passed in — so both read identically in the panel.
-->
<template>
  <nav class="flex flex-col gap-0.5">
    <SidebarItem
      v-for="box in items ?? MAILBOXES"
      :key="box.id"
      :label="box.label"
      :icon="box.icon"
      :suffix="unreadIn(box.id) ? String(unreadIn(box.id)) : undefined"
      :to="areaTo('mail', box.id)"
      :active="activeMailbox === box.id"
    />
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { SidebarItem } from 'frappe-ui'

import { MAILBOXES, unreadIn, type Mailbox } from '../mailFixtures'
import { useShellNav } from '../useShellNav'

defineProps<{ items?: Mailbox[] }>()

const { sub, areaTo } = useShellNav()
const activeMailbox = computed(() => sub.value || 'inbox')
</script>
