<!--
  The one Drive share dialog (unified spec §7). The Drive area and every
  document surface open it through `useDriveDialogs().share()` or
  `session.share()`. On phone it opens as a bottom sheet with the same body.
-->
<template>
  <BottomSheet v-if="isPhone" :open="open" :title="heading" @update:open="open = $event" @after-leave="emit('after-leave')">
    <div class="px-4 pb-8">
      <ShareBody :state="state" />
    </div>
  </BottomSheet>
  <Dialog v-else v-model:open="open" :title="heading" size="xl" @after-leave="emit('after-leave')">
    <!-- One fixed height: loading and each re-read never move the controls. -->
    <div class="-mx-1 h-96 overflow-y-auto px-1">
      <ShareBody :state="state" />
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { BottomSheet, Dialog } from 'frappe-ui'
import { useMediaQuery } from '@vueuse/core'

import { confirm } from '@/platform/feedback'
import { useSession } from '@/platform/session'

import ShareBody from './ShareBody.vue'
import { useShare } from './useShare'

const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ 'after-leave': []; changed: [value: boolean] }>()

const isPhone = useMediaQuery('(max-width: 767px)')
const session = useSession()
const state = useShare(props.node, {
  me: session.user.value?.id,
  confirmLoss: () =>
    confirm({
      title: 'Change your own access?',
      message: 'You will no longer be able to share this item.',
      confirmLabel: 'Change',
      destructive: true,
    }),
})
const heading = computed(() => (state.node.value ? `Share "${state.node.value.title}"` : 'Share'))

onMounted(() => void state.load())
// The opener refreshes what it shows when a write went through.
watch(state.changed, (value) => value && emit('changed', true))
</script>
