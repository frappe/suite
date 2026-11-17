<!--
  Moves its content onto the title line of the `<SettingsDialogRow>` dialog it renders in, so a
  part's own buttons sit beside its title. Outside a row dialog the content stays where it is.
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
