<!--
  PROTOTYPE — remove. The Screener's own sidebar row. It sits above the
  labelled sections because it is a queue of decisions, not a place mail is
  filed. The row stays once the queue is empty — the screened-out list is
  reached through it — and only the count goes away.
-->
<template>
  <SidebarItem
    label="Screener"
    icon="lucide-user-round-check"
    :suffix="waiting.length ? String(waiting.length) : undefined"
    :to="areaTo('mail', 'screener')"
    :active="activeMailbox === 'screener'"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { SidebarItem } from 'frappe-ui'

import { screenerWaiting } from '../mailFixtures'
import { useShellNav } from '../useShellNav'

const { sub, areaTo } = useShellNav()
const activeMailbox = computed(() => sub.value || 'inbox')
const waiting = computed(() => screenerWaiting())
</script>
