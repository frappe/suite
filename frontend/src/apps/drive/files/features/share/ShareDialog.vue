<!--
  The one Drive share dialog (unified spec §7). The Drive area and every
  document surface open it through `useDriveDialogs().share()` or
  `session.share()`. On phone it opens as a bottom sheet with the same body.
-->
<template>
  <BottomSheet v-if="isPhone" :open="open" @update:open="open = $event" @after-leave="$emit('after-leave')">
    <div class="max-h-[80vh] overflow-y-auto px-4 pb-8">
      <DialogTitle class="truncate pb-3 text-lg-semibold text-ink-gray-9">{{ heading }}</DialogTitle>
      <ShareBody :state="state" />
    </div>
  </BottomSheet>
  <Dialog v-else v-model:open="open" :title="heading" size="xl" @after-leave="$emit('after-leave')">
    <ShareBody :state="state" />
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { BottomSheet, Dialog } from 'frappe-ui'
import { useMediaQuery } from '@vueuse/core'
import { DialogTitle } from 'reka-ui'

import ShareBody from './ShareBody.vue'
import { useShare } from './useShare'

const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
defineEmits<{ 'after-leave': [] }>()

const isPhone = useMediaQuery('(max-width: 767px)')
const state = useShare(props.node)
const heading = computed(() => (state.node.value ? `Share "${state.node.value.title}"` : 'Share'))

onMounted(() => void state.load())
</script>
