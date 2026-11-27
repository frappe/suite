<template>
  <!-- What sits over a list (its category cards and filter chips) moves, on a phone, into the top of
       the list (`into`), so it scrolls away with the rows and shows only at the top. Where there is
       no list to move into (still loading, say), it stays where it is, and a desktop keeps it there. -->
  <Teleport defer :to="into ?? 'body'" :disabled="!isMobile || !into">
    <slot />
  </Teleport>
</template>

<script setup lang="ts">
import { useScreenSize } from '@/apps/mail/utils/composables'

defineProps<{ into: HTMLElement | null }>()

const { isMobile } = useScreenSize()
</script>
