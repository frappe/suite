<!--
  Moves its content to the bottom of the `<SettingsDialogRow>` dialog it renders in, so a part's
  own buttons are the dialog's actions. Outside a row dialog the content stays where it is.
-->
<template>
  <Teleport :to="target" :disabled="isInPlace">
    <slot />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'

import { SETTINGS_DIALOG_ACTIONS_KEY } from '@/platform/settings'

defineSlots<{ default?: () => unknown }>()

const target = inject(SETTINGS_DIALOG_ACTIONS_KEY, null)
const isInPlace = computed(() => !target?.value)
</script>
