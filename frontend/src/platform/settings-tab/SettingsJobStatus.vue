<!--
  The last row of an import or export form: whether a background job is
  running, a link to it or to past jobs, and the button that starts one
  (default slot). Put it in the `SettingsSection` under the rows it starts.
-->
<template>
  <div class="flex flex-wrap items-center justify-between gap-3 py-3.5">
    <p class="text-p-sm text-ink-gray-5">
      {{ status }}
      <a class="text-ink-gray-7 underline underline-offset-2" :href="href" target="_blank">
        {{ linkLabel }}
      </a>
    </p>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ status: string; href: string; linkLabel: string }>()
defineSlots<{ default?: () => unknown }>()
</script>
