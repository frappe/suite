<!-- PROTOTYPE — remove. Mailbox nav shared by every variant's mail chrome. -->
<template>
  <nav class="flex flex-col gap-0.5">
    <SidebarItem
      v-for="box in MAILBOXES"
      :key="box.id"
      :label="box.label"
      :icon="box.icon"
      :suffix="box.unread ? String(box.unread) : undefined"
      :to="areaTo('mail', box.id)"
      :active="activeMailbox === box.id"
    />
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { SidebarItem } from 'frappe-ui'

import { MAILBOXES } from '../fixtures'
import { useShellNav } from '../useShellNav'

const { sub, areaTo } = useShellNav()
const activeMailbox = computed(() => sub.value || 'inbox')
</script>
