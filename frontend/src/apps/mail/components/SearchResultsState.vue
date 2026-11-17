<template>
  <!-- A search that came back with nothing to list says which kind of nothing, and offers the way on:
       the two look the same on the screen and call for opposite next steps. -->
  <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <template v-if="failed">
      <p class="text-p-base text-ink-gray-8">{{ __("Couldn't search your mail.") }}</p>
      <p class="text-p-sm text-ink-gray-5">
        {{ __('The mail server did not answer. Your mail is fine.') }}
      </p>
      <Button :label="__('Try again')" @click="emit('retry')" />
    </template>
    <template v-else>
      <p class="text-p-base text-ink-gray-8">
        {{ text ? __('No mail matches "{0}"', [text]) : __('No mail matches these filters') }}
      </p>
      <p v-if="text" class="text-p-sm text-ink-gray-5">
        {{ __('Search looks for whole words, so try the full word rather than part of it.') }}
      </p>
      <div v-if="canClearFilters || canWiden" class="flex flex-wrap justify-center gap-2">
        <Button
          v-if="canClearFilters"
          :label="__('Remove filters')"
          @click="emit('clearFilters')"
        />
        <Button v-if="canWiden" :label="__('Search all accounts')" @click="emit('widen')" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

defineProps<{
  failed?: boolean
  /** The words searched for, if any were. */
  text?: string
  canClearFilters?: boolean
  /** Other accounts exist that this search hasn't looked in. */
  canWiden?: boolean
}>()
const emit = defineEmits<{ retry: []; clearFilters: []; widen: [] }>()
</script>
