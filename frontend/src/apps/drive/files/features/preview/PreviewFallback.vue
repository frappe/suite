<script setup lang="ts">
import { Button } from "frappe-ui";

/** Shown in place of a preview, with the file's download link when it has one. */
defineProps<{ title: string; message: string; download?: string }>();
</script>

<template>
  <div class="m-auto max-w-md px-6 text-center">
    <span class="lucide-file-question mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
    <h2 class="mt-3 text-lg-semibold text-ink-gray-9">{{ title }}</h2>
    <p class="mt-1 text-p-sm text-ink-gray-6">{{ message }}</p>
    <Button v-if="download" class="mt-4" label="Download" icon-left="lucide-download" :href="download" />
  </div>
</template>
