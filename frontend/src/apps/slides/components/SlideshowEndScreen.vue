<template>
  <div class="flex gap-8">
    <Button
      label="Back"
      size="lg"
      :variant="'outline'"
      class="bg-transparent text-white opacity-70 transition-opacity duration-300 hover:opacity-100"
    >
      <template #prefix>
        <LucideChevronLeft class="size-4 stroke-[1.5]" />
      </template>
    </Button>
    <Button
      label="Replay"
      size="lg"
      class="opacity-90 transition-opacity duration-200 hover:opacity-100"
      @click.stop="$emit('restartSlideShow')"
    >
      <template #prefix>
        <LucideRotateCcw class="size-4 stroke-[1.5]" />
      </template>
    </Button>
  </div>
</template>

<script setup>
import { Button } from 'frappe-ui'

const emit = defineEmits(['restartSlideShow'])
</script>

<style lang="scss" scoped></style>
