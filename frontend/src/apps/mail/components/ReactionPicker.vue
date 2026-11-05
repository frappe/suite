<!--
  The button that adds a reaction: a short palette, opening onto every emoji, on hover or on a press.
  Its attributes go to the button, so each place it sits can dress it as its neighbours are.

  On a message that can't be reacted to it stays in place, disabled, and says why on hover. The
  tooltip hangs off a wrapper because a disabled button takes no pointer events of its own.
-->
<template>
  <Tooltip v-if="refusal" :text="refusal">
    <span class="inline-flex">
      <Button
        variant="ghost"
        v-bind="$attrs"
        class="pointer-events-none"
        disabled
        :aria-label="refusal"
      >
        <template #icon>
          <SmilePlus class="text-ink-gray-5 icon" />
        </template>
      </Button>
    </span>
  </Tooltip>
  <EmojiPicker v-else v-model="picked" v-model:reaction="shortPalette" open-on-hover>
    <template #default="{ press, hover }">
      <Button
        variant="ghost"
        v-bind="{ ...$attrs, ...hover }"
        :aria-label="__('Add reaction')"
        @click="press"
      >
        <template #icon>
          <SmilePlus class="text-ink-gray-5 icon" />
        </template>
      </Button>
    </template>
  </EmojiPicker>
</template>

<script setup lang="ts">
import { Button, Tooltip } from 'frappe-ui'
import { SmilePlus } from 'lucide-vue-next'
import { ref, watch } from 'vue'

import EmojiPicker from '@/apps/mail/components/EmojiPicker.vue'

defineOptions({ inheritAttrs: false })

defineProps<{ refusal?: string | null }>()

const emit = defineEmits<{ pick: [emoji: string] }>()

const shortPalette = ref(true)

// Cleared after every pick, so choosing the same emoji again still comes through.
const picked = ref<string>()
watch(picked, (emoji) => {
  if (!emoji) return
  picked.value = undefined
  emit('pick', emoji)
})
</script>
