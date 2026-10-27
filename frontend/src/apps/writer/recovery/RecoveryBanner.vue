<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed, onMounted } from 'vue'

import DocumentStrip from '@/apps/writer/components/DocumentStrip.vue'

import { savedAtLabel, type RecoveryCopy } from './copies'
import { useRecoveryCopies } from './useRecoveryCopies'

/** The latest copy of this document kept on this device; older ones are listed on their own page. */
const props = defineProps<{ node: string }>()
defineEmits<{ view: [copy: RecoveryCopy] }>()

const { copies, refresh } = useRecoveryCopies(props.node)
const latest = computed(() => copies.value[0])

onMounted(refresh)

defineExpose({ refresh })
</script>

<template>
  <DocumentStrip v-if="latest" tone="blue">
    <p class="truncate">
      {{ __('This device has unsaved work from {0}', [savedAtLabel(latest)]) }}
    </p>
    <Button
      size="sm"
      variant="ghost"
      theme="blue"
      :label="__('View')"
      @click="$emit('view', latest)"
    />
  </DocumentStrip>
</template>
