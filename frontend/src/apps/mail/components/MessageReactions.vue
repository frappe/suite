<!--
  The reactions a message has collected, as one chip per emoji. Nothing at all until it has one:
  adding the first is the message header's, and for the newest message the bar beside Forward's.
  Pressing a chip adds the reader to it. Pressing your own says you already reacted.
-->
<template>
  <div v-if="groups.length" class="flex flex-wrap items-center gap-1.5">
    <Button
      v-for="group in groups"
      :key="group.emoji"
      :variant="group.mine ? 'subtle' : 'outline'"
      :tooltip="group.who"
      :aria-pressed="group.mine"
      :disabled="readonly"
      @click="emit('react', group.emoji)"
    >
      <span class="flex items-center gap-1">
        <span>{{ group.emoji }}</span>
        <span class="tabular-nums">{{ group.count }}</span>
      </span>
    </Button>

    <ReactionPicker v-if="!readonly" @pick="(emoji: string) => emit('react', emoji)" />
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'

import ReactionPicker from '@/apps/mail/components/ReactionPicker.vue'
import type { MailReaction } from '@/apps/mail/types'
import { useOwnEmails } from '@/apps/mail/utils/composables'
import { groupReactions } from '@/apps/mail/utils/reactions'

const { reactions, readonly } = defineProps<{
  reactions: MailReaction[]
  readonly?: boolean
}>()

const emit = defineEmits<{ react: [emoji: string] }>()

const ownEmails = useOwnEmails()
const groups = computed(() => groupReactions(reactions, ownEmails.value, __))
</script>
