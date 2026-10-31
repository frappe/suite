<!--
  Moves its content below the body of the `<AreaSidebar>` it renders in, so a
  sidebar body can add a footer without the page that owns the sidebar. Outside
  an area sidebar it renders nothing.
-->
<template>
  <Teleport v-if="target" :to="target">
    <slot />
  </Teleport>
</template>

<script setup lang="ts">
import { inject } from 'vue'

import { AREA_SIDEBAR_FOOTER_KEY } from './state'

defineSlots<{ default?: () => unknown }>()

const target = inject(AREA_SIDEBAR_FOOTER_KEY, null)
</script>
