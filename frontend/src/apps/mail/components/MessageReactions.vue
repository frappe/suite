<!--
  The reactions a message has collected, as one chip per emoji, and the button to add another. Nothing
  at all until it has one: the button is elsewhere until then (see reactionButtonSpot). Pressing a
  chip adds the reader to it. Pressing your own says you already reacted.
-->
<template>
  <div v-if="groups.length" class="flex flex-wrap items-center gap-1.5">
    <!-- The tooltip is on a wrapper so that it still says who reacted when the chip is disabled,
         and a disabled button takes no pointer events of its own. -->
    <Tooltip v-for="group in groups" :key="group.emoji" :text="group.who">
      <span class="inline-flex">
        <Button
          variant="subtle"
          class="rounded-full"
          :class="{
            '!bg-surface-gray-4 hover:!bg-surface-gray-5': group.mine,
            'pointer-events-none': unavailable,
          }"
          :aria-pressed="group.mine"
          :disabled="unavailable"
          @click="emit('react', group.emoji)"
        >
          <span class="flex items-center gap-1.5">
            <span>{{ group.emoji }}</span>
            <span class="tabular-nums" :class="group.mine ? 'text-ink-gray-8' : 'text-ink-gray-6'">
              {{ group.count }}
            </span>
          </span>
        </Button>
      </span>
    </Tooltip>

    <ReactionPicker
      v-if="!readonly"
      variant="subtle"
      class="rounded-full"
      :refusal
      @pick="(emoji: string) => emit('react', emoji)"
    />
  </div>
</template>

<script setup lang="ts">
import { Button, Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import ReactionPicker from '@/apps/mail/components/ReactionPicker.vue'
import type { MailReaction } from '@/apps/mail/types'
import { useOwnEmails } from '@/apps/mail/utils/composables'
import { groupReactions } from '@/apps/mail/utils/reactions'

const { reactions, readonly, refusal } = defineProps<{
  reactions: MailReaction[]
  readonly?: boolean
  refusal?: string | null
}>()

const emit = defineEmits<{ react: [emoji: string] }>()

const ownEmails = useOwnEmails()
const groups = computed(() => groupReactions(reactions, ownEmails.value, __))
const unavailable = computed(() => readonly || !!refusal)
</script>
