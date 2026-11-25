<!--
  Moves its content to the bottom of the `<SettingsDialogRow>` dialog it renders in, so a part's
  own buttons are the dialog's actions. With `bar`, a button for the whole page, such as adding to
  a list, goes by the title instead: in the dialog's header, or the bar of the part's page on a
  phone. Outside a row dialog the content stays where it is.
-->
<template>
  <Teleport :to="target" :disabled="isInPlace">
    <slot />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'

import { SETTINGS_DIALOG_ACTIONS_KEY, SETTINGS_PART_BAR_KEY } from '@/platform/settings'

const { bar = false } = defineProps<{ bar?: boolean }>()
defineSlots<{ default?: () => unknown }>()

const dialogActions = inject(SETTINGS_DIALOG_ACTIONS_KEY, null)
const partBar = inject(SETTINGS_PART_BAR_KEY, null)
const target = computed(() => (bar && partBar?.value) || dialogActions?.value)
const isInPlace = computed(() => !target.value)
</script>
