<!--
  A phone's reactions to one message, as a sheet: emoji to react with, then who reacted with each.
  A computer says who in a chip's tooltip, which a touch has no way to reach. The grid starts with
  the desktop's palette; its last cell trades this sheet for one of every emoji, at that list's own
  height. A message that can't be reacted to says why in the grid's place, and still lists who
  reacted. A read-only view lists who reacted alone.
-->
<template>
  <BottomSheet v-model:open="open" :title="__('Reactions')">
    <div class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <template v-if="!readonly">
        <p v-if="refusal" class="text-p-base text-ink-gray-6 px-2 pb-2 text-center">
          {{ refusal }}
        </p>
        <!-- Its first emoji starts where the full list's first one does -->
        <div v-else class="grid grid-cols-[repeat(5,3rem)] justify-between gap-y-6">
          <button
            v-for="emoji in PHONE_REACTIONS"
            :key="emoji"
            type="button"
            class="active:bg-surface-gray-3 flex size-12 items-center justify-center rounded-full text-3xl transition active:scale-95"
            :class="{ 'bg-surface-gray-2': mine.has(emojiKey(emoji)) }"
            :aria-pressed="mine.has(emojiKey(emoji))"
            @click="pick(emoji)"
          >
            {{ emoji }}
          </button>
          <button
            type="button"
            :aria-label="__('More reactions')"
            class="text-ink-gray-6 active:bg-surface-gray-3 flex size-12 items-center justify-center rounded-full transition active:scale-95"
            @click="showEvery"
          >
            <Plus class="size-6" />
          </button>
        </div>
      </template>
      <!-- Each row's emoji and count sit under the grid's first and last columns -->
      <ul v-if="groups.length" class="space-y-3" :class="{ 'mt-4 border-t pt-4': !readonly }">
        <li v-for="group in groups" :key="group.emoji" class="flex items-baseline">
          <span class="w-12 shrink-0 text-center text-3xl" aria-hidden="true">
            {{ group.emoji }}
          </span>
          <p class="text-p-base text-ink-gray-8 min-w-0 flex-1">
            <span class="sr-only">{{ group.emoji }}</span>
            {{ group.who }}
          </p>
          <span class="text-ink-gray-5 w-12 shrink-0 text-center text-base">
            {{ group.count }}
          </span>
        </li>
      </ul>
    </div>
  </BottomSheet>
  <BottomSheet v-model:open="everyOpen" :title="__('Emoji')">
    <div class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <EmojiGrid class="!w-full" :picker :auto-focus="false" @select="pick" />
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import type { Picker } from 'emoji-mart'
import { BottomSheet } from 'frappe-ui'
import { Plus } from 'lucide-vue-next'
import { computed, ref, shallowRef } from 'vue'

import { emojiKey, type ReactionGroup } from '@/apps/mail/utils/reactions'
import EmojiGrid from '@/platform/emoji-picker/EmojiGrid.vue'
import { prepareEmojiPicker } from '@/platform/emoji-picker/prepareEmojiPicker'
import { QUICK_REACTIONS } from '@/platform/emoji-picker/reactionEmojis'
import { translate as __ } from '@/platform/translation'

const open = defineModel<boolean>('open', { default: false })
const { groups, readonly, refusal } = defineProps<{
  groups: ReactionGroup[]
  readonly?: boolean
  refusal?: string | null
}>()
const emit = defineEmits<{ pick: [emoji: string] }>()

// Two rows of five, the last cell More
const PHONE_REACTIONS = [...QUICK_REACTIONS, '🎉', '🔥', '👏']

const mine = computed(() => new Set(groups.filter((g) => g.mine).map((g) => emojiKey(g.emoji))))

// Every emoji, in a sheet of its own once More has loaded them. A failed load says so there.
const picker = shallowRef<typeof Picker>()
const everyOpen = ref(false)
let request = 0
async function showEvery() {
  const asked = ++request
  const loaded = await prepareEmojiPicker()
  if (asked !== request || !open.value) return
  picker.value = loaded
  open.value = false
  everyOpen.value = true
}

function pick(emoji: string) {
  emit('pick', emoji)
  open.value = false
  everyOpen.value = false
}
</script>
