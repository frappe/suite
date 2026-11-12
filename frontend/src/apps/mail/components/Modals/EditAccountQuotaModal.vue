<!-- Account details use the same limit review and outcome handling as Storage. -->
<script setup lang="ts">
import StorageLimitDialog from './StorageLimitDialog.vue'

const show = defineModel<boolean>()
defineProps<{ member: { name: string } }>()
const emit = defineEmits<{ reload: [] }>()
</script>

<template>
  <StorageLimitDialog v-model:open="show" :users="[member.name]" @saved="emit('reload')" />
</template>
