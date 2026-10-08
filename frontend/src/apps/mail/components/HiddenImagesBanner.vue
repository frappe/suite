<template>
  <!-- A thread's remote content is withheld until the reader asks for it, so a sender cannot use it to
	     tell when their mail was opened. One banner for the whole thread: Show loads it in every message.
	     A rounded, bordered banner on desktop; a full-bleed row on a phone. -->
  <div
    class="bg-surface-base text-p-sm text-ink-gray-8 flex items-center gap-3 border-b py-1.5 pl-3 pr-1.5 sm:rounded-6 sm:border"
  >
    <ImageOff class="text-ink-gray-5 size-4 shrink-0" />
    <span class="flex-1">
      {{
        images === 0
          ? __('Remote content hidden.')
          : images === 1
            ? __('1 image hidden.')
            : __('{0} images hidden.', [String(images)])
      }}
    </span>
    <Button variant="ghost" :label="__('Show')" @click="emit('show')" />
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { ImageOff } from 'lucide-vue-next'

/** How many remote images are hidden; 0 when what is hidden is other remote content. */
defineProps<{ images: number }>()
const emit = defineEmits<{ show: [] }>()
</script>
