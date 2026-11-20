<template>
  <!-- A thread's toolbar buttons before the thread is in, in the groups they will stand in (see
       ThreadHeader), so the row doesn't fill in from nothing. For the eye alone; whoever shows it
       says the thread is loading. -->
  <div
    class="flex min-w-0 items-center gap-2 max-sm:gap-1.5"
    aria-hidden="true"
    data-outline="thread-actions"
  >
    <template v-for="(count, group) in groups" :key="group">
      <Divider v-if="group" v-bind="GROUP_LINE" />
      <div class="flex items-center space-x-2">
        <ThreadButtonOutline v-for="n in count" :key="n" />
      </div>
    </template>
    <!-- A phone's More, a step apart from the groups and with no line before it. -->
    <ThreadButtonOutline v-if="isMobile && !drafts" class="ml-1.5" />
  </div>
</template>

<script setup lang="ts">
import { Divider } from 'frappe-ui'
import { computed } from 'vue'

import ThreadButtonOutline from '@/apps/mail/components/ThreadButtonOutline.vue'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { GROUP_LINE } from '@/apps/mail/utils/toolbarGroups'

// `drafts`: the thread is opened from Drafts, which offers Discard alone.
const { drafts = false } = defineProps<{ drafts?: boolean }>()
const { isMobile } = useScreenSize()

// How many buttons each group holds: the row an Inbox thread gets (act on it, file it, hold it for
// later), where a phone keeps only the first group and the rest in its More sheet.
const groups = computed(() => (drafts ? [1] : isMobile.value ? [4] : [5, 2, 2]))
</script>
