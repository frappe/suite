<!--
  A Drive settings tab: frappe-ui's header and body in the Settings dialog, or
  plain page flow on a phone settings page. The shell provides the string key
  and the actions target, so Drive needs no shell import.
-->
<template>
  <template v-if="phonePage">
    <!-- defer: the phone page mounts as one new layer, so the bar's target
         is not in the document yet while this page mounts. -->
    <Teleport v-if="$slots.actions" defer to="#app-settings-page-actions">
      <slot name="actions" />
    </Teleport>
    <p v-if="description" class="shrink-0 px-4 pt-4 text-base text-ink-gray-6">{{ description }}</p>
    <div class="px-4 pb-8 pt-4">
      <slot />
    </div>
  </template>
  <template v-else>
    <SettingsHeader :title="title" :description="description">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SettingsHeader>
    <SettingsBody>
      <div class="pt-6">
        <slot />
      </div>
    </SettingsBody>
  </template>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { SettingsBody, SettingsHeader } from 'frappe-ui'

defineProps<{ title: string; description?: string }>()
defineSlots<{ default?: () => unknown; actions?: () => unknown }>()

const phonePage = inject('app-settings-mobile-page', false)
</script>
