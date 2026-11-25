<!--
  A phone's reactions to one message, as a sheet: emoji to react with, then who reacted with each.
  A computer says who in a chip's tooltip, which a touch has no way to reach. The grid starts with
  the desktop's palette; its last cell swaps the grid and the list for every emoji, at the sheet's
  full width. A message that can't be reacted to says why in the grid's place, and still lists who
  reacted. A read-only view lists who reacted alone.
-->
<template>
  <BottomSheet v-model:open="open" :title="__('Reactions')">
    <div class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <template v-if="!readonly">
        <p v-if="refusal" class="text-p-base text-ink-gray-6 px-2 pb-2 text-center">
          {{ refusal }}
        </p>
        <EmojiGrid v-else-if="picker" class="!w-full" :picker :auto-focus="false" @select="pick" />
        <!-- Square cells, so the rows sit as far apart as the columns at any width. A whole cell
             takes the tap; the circle in it shows the press and a reaction of yours. -->
        <div v-else class="grid grid-cols-5">
          <button
            v-for="emoji in PHONE_REACTIONS"
            :key="emoji"
            type="button"
            class="group flex aspect-square items-center justify-center text-2xl"
            :aria-pressed="mine.has(emojiKey(emoji))"
            @click="pick(emoji)"
          >
            <span
              class="group-active:bg-surface-gray-3 flex size-12 items-center justify-center rounded-full transition group-active:scale-95"
              :class="{ 'bg-surface-gray-2': mine.has(emojiKey(emoji)) }"
            >
              {{ emoji }}
            </span>
          </button>
          <button
            type="button"
            :aria-label="__('More reactions')"
            class="group text-ink-gray-6 flex aspect-square items-center justify-center"
            @click="showEvery"
          >
            <span
              class="group-active:bg-surface-gray-3 flex size-12 items-center justify-center rounded-full transition group-active:scale-95"
            >
              <Plus class="size-6" />
            </span>
          </button>
        </div>
      </template>
      <!-- On the grid's columns: the emoji under the first, the count under the last -->
      <ul
        v-if="groups.length && !picker"
        class="space-y-3"
        :class="{ 'mt-2 border-t pt-4': !readonly }"
      >
        <li v-for="group in groups" :key="group.emoji" class="grid grid-cols-5 items-baseline">
          <span class="text-center text-xl" aria-hidden="true">{{ group.emoji }}</span>
          <p class="text-p-base text-ink-gray-8 col-span-3 min-w-0">
            <span class="sr-only">{{ group.emoji }}</span>
            {{ group.who }}
          </p>
          <span class="text-ink-gray-5 text-center text-base">{{ group.count }}</span>
        </li>
      </ul>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import type { Picker } from 'emoji-mart'
import { BottomSheet } from 'frappe-ui'
import { Plus } from 'lucide-vue-next'
import { computed, shallowRef, watch } from 'vue'

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

// Four rows of five, the last cell More
const PHONE_REACTIONS = [
  ...QUICK_REACTIONS,
  ...['👎', '🔥', '🎉', '👏', '😍', '🤔', '😊', '💯', '✅', '👀', '🙌', '😅', '🚀'],
]

const mine = computed(() => new Set(groups.filter((g) => g.mine).map((g) => emojiKey(g.emoji))))

// Every emoji, once More has loaded them. It opens on the grid each time.
const picker = shallowRef<typeof Picker>()
watch(open, (isOpen) => {
  if (isOpen) picker.value = undefined
})
let request = 0
async function showEvery() {
  const asked = ++request
  const loaded = await prepareEmojiPicker()
  if (asked === request && open.value) picker.value = loaded
}

function pick(emoji: string) {
  emit('pick', emoji)
  open.value = false
}
</script>
