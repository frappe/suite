<template>
  <!-- Straight on the dimmed preview, so the person waiting still sees their own picture. -->
  <div class="absolute inset-0 z-50 flex bg-black/60 backdrop-blur-sm">
    <MeetStatusScreen
      icon="lucide-clock"
      tone="warning"
      :title="__('Waiting to be admitted')"
      :description="__('The meeting host will let you in soon.')"
      :action-label="__('Leave')"
      @action="$emit('leave')"
    />
  </div>
</template>

<script setup lang="ts">
import MeetStatusScreen from './MeetStatusScreen.vue'

defineEmits<{
  leave: []
}>()
</script>
