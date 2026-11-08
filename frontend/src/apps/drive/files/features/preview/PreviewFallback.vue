<script setup lang="ts">
import { Button } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

/**
 * Shown in place of a preview, with the file's download link when it has one.
 * `failed` says the preview did not load, in place of `title` and `message`.
 * The default slot adds actions before the link.
 */
defineProps<{ title?: string; message?: string; failed?: boolean; download?: string }>()
</script>

<template>
  <div class="m-auto max-w-md px-6 text-center">
    <span class="lucide-file-question mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
    <h2 class="mt-3 text-lg-semibold text-ink-gray-9">
      {{ failed ? __('Could not load the preview') : title }}
    </h2>
    <p class="mt-1 text-p-sm text-ink-gray-6">
      {{ failed ? __('Download this file to open it.') : message }}
    </p>
    <div class="mt-4 flex justify-center gap-2">
      <slot />
      <Button v-if="download" label="Download" icon-left="lucide-download" :href="download" />
    </div>
  </div>
</template>
