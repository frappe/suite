<template>
  <!-- On a phone settings page the page bar already shows the tab title and
       hosts the actions, which teleport into its actions slot. Only an
       optional description renders in the flow. -->
  <template v-if="phonePage">
    <!-- defer: the page slides in as one new layer, so the bar's target is
         not in the document yet while this header mounts. -->
    <Teleport defer :to="`#${SETTINGS_PAGE_ACTIONS_ID}`">
      <slot name="actions" />
    </Teleport>
    <div v-if="$slots.default || description" class="shrink-0 px-4 pt-4">
      <slot>
        <p class="min-w-0 text-base text-ink-gray-6">{{ description }}</p>
      </slot>
    </div>
  </template>
  <SettingsHeader v-else v-bind="$attrs" :title="title" :description="description">
    <template v-if="$slots.default" #default>
      <slot />
    </template>
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
  </SettingsHeader>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { SettingsHeader } from 'frappe-ui'

import { SETTINGS_PAGE_ACTIONS_ID, SETTINGS_PHONE_PAGE } from '@/shell/settings/settings'

defineOptions({ inheritAttrs: false })
defineProps<{ title?: string; description?: string }>()
defineSlots<{ default?: () => unknown; actions?: () => unknown }>()

const phonePage = inject(SETTINGS_PHONE_PAGE, false)
</script>
