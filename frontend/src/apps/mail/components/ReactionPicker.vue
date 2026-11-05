<!--
  The button that adds a reaction: a short palette, opening onto every emoji. Its attributes go to
  the button, so each place it sits can dress it as its neighbours are. A native title rather than a
  tooltip: focus returns to the button when the palette closes, and a tooltip would open on that and
  cover whatever is beside it.

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
  <EmojiPicker v-else v-model="picked" v-model:reaction="shortPalette">
    <template #default="{ toggle, open }">
      <Button
        variant="ghost"
        v-bind="$attrs"
        :title="__('Add reaction')"
        :aria-label="__('Add reaction')"
        @click="openPicker(toggle, open)"
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

// The picker opens on the short palette each time, whichever view it was left on.
const shortPalette = ref(true)
const openPicker = (toggle: () => void, open: boolean) => {
  if (!open) shortPalette.value = true
  toggle()
}

// Cleared after every pick, so choosing the same emoji again still comes through.
const picked = ref<string>()
watch(picked, (emoji) => {
  if (!emoji) return
  picked.value = undefined
  emit('pick', emoji)
})
</script>
