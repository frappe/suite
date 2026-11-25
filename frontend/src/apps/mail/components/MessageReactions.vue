<!--
  The foot of a message: its reactions, one chip per emoji, and the button to add one. Pressing a chip
  adds the reader to it. Pressing your own says you already reacted. In a read-only view with nothing
  to show, it isn't there at all.

  On a phone the chips and the button open a sheet (ReactionSheet) that says who reacted and offers
  emoji to react with: a tooltip can't be reached by touch, and a reaction is mail that goes out, so
  a chip under a thumb doesn't send one by itself. They are a size up there, for a finger.
-->
<template>
  <div v-if="groups.length || !readonly" class="flex flex-wrap items-center gap-1.5">
    <!-- The tooltip is on a wrapper so that it still says who reacted when the chip is disabled,
         and a disabled button takes no pointer events of its own. -->
    <Tooltip v-for="group in groups" :key="group.emoji" :text="isMobile ? undefined : group.who">
      <span class="inline-flex">
        <Button
          variant="subtle"
          :size="isMobile ? 'md' : 'sm'"
          class="rounded-full"
          :class="{
            '!bg-surface-gray-4 hover:!bg-surface-gray-5': group.mine,
            'pointer-events-none': unavailable && !isMobile,
          }"
          :aria-pressed="group.mine"
          :disabled="unavailable && !isMobile"
          @click="isMobile ? (sheetOpen = true) : emit('react', group.emoji)"
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

    <template v-if="!readonly">
      <Button
        v-if="isMobile"
        variant="subtle"
        size="md"
        class="rounded-full"
        :aria-label="__('Reactions')"
        @click="sheetOpen = true"
      >
        <template #icon>
          <SmilePlus class="text-ink-gray-5 icon" />
        </template>
      </Button>
      <ReactionPicker
        v-else
        variant="subtle"
        class="rounded-full"
        :refusal
        @pick="(emoji: string) => emit('react', emoji)"
      />
    </template>
    <ReactionSheet
      v-if="isMobile"
      v-model:open="sheetOpen"
      :groups
      :readonly
      :refusal
      @pick="(emoji: string) => emit('react', emoji)"
    />
  </div>
</template>

<script setup lang="ts">
import { Button, Tooltip } from 'frappe-ui'
import { SmilePlus } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import ReactionPicker from '@/apps/mail/components/ReactionPicker.vue'
import ReactionSheet from '@/apps/mail/components/ReactionSheet.vue'
import type { MailReaction } from '@/apps/mail/types'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { groupReactions } from '@/apps/mail/utils/reactions'

const { reactions, ownEmails, readonly, refusal } = defineProps<{
  reactions: MailReaction[]
  ownEmails: Set<string>
  readonly?: boolean
  refusal?: string | null
}>()

const emit = defineEmits<{ react: [emoji: string] }>()

const { isMobile } = useScreenSize()
const sheetOpen = ref(false)
const groups = computed(() => groupReactions(reactions, ownEmails, __))
const unavailable = computed(() => readonly || !!refusal)
</script>
