<template>
  <!-- A message's remote content is withheld until the reader asks for it, so a sender cannot use it
	     to tell when their mail was opened. A note about this message, not a decision: the bars that
	     ask for one (the Screener's, a blocked sender's) are filled; this is a line of grey text on
	     the body's edge, Show a link right after it, so it never competes with them. -->
  <div class="text-p-sm text-ink-gray-5 flex items-center gap-2">
    <ImageOff class="size-4 shrink-0" />
    <span>
      {{
        images === 0
          ? __('Remote content hidden to protect your privacy.')
          : images === 1
            ? __('1 image hidden to protect your privacy.')
            : __('{0} images hidden to protect your privacy.', [String(images)])
      }}
      <button
        type="button"
        class="text-ink-gray-7 hover:text-ink-gray-8 font-medium underline-offset-2 hover:underline"
        @click="emit('show')"
      >
        {{ __('Show') }}
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
import { ImageOff } from 'lucide-vue-next'

/** How many remote images are hidden; 0 when what is hidden is other remote content. */
defineProps<{ images: number }>()
const emit = defineEmits<{ show: [] }>()
</script>
