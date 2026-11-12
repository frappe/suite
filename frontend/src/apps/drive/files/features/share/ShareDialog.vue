<!--
  The one Drive share dialog (unified spec §7). The Drive area and every
  document surface open it through `useDriveDialogs().share()` or
  `session.share()`. On phone it opens as a bottom sheet with the same body.
-->
<template>
  <BottomSheet
    v-if="isPhone"
    :open="open"
    :title="__('Share')"
    @update:open="setOpen"
    @after-leave="emit('after-leave')"
  >
    <div class="px-4 pb-8">
      <ShareDialogHeader :node="state.node.value" :placeholders="placeholders" />
      <ShareBody v-model:picked="picked" :state="state" />
      <ShareDialogFooter
        v-if="!picked"
        class="mt-5 border-t border-outline-gray-1 pt-4"
        :address="address"
        :caption="caption"
        :placeholders="placeholders"
        @done="open = false"
      />
    </div>
  </BottomSheet>
  <Dialog
    v-else
    :open="open"
    :title="__('Share')"
    size="xl"
    @update:open="setOpen"
    @after-leave="emit('after-leave')"
  >
    <div
      ref="body"
      class="-mx-1 -mt-5 flex flex-col px-1"
      :class="{ 'max-h-[min(36rem,calc(100dvh_-_16rem))] overflow-y-auto': !picked }"
      :style="picked ? { minHeight: `${pickingHeight}px` } : undefined"
    >
      <ShareDialogHeader :node="state.node.value" :placeholders="placeholders" />
      <ShareBody v-model:picked="picked" class="flex-1" :state="state" autofocus-picker />
    </div>
    <template v-if="!picked" #actions>
      <ShareDialogFooter
        :address="address"
        :caption="caption"
        :placeholders="placeholders"
        @done="open = false"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { BottomSheet, Dialog } from 'frappe-ui'
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'

import { driveNodeRoute } from '@/apps/drive'
import { DRIVE_ROLES, type DriveNode } from '@/apps/drive/client/types'
import { confirm } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { useWorkspace } from '@/platform/workspace'

import { useLocationTitle } from '../../internal/locations'
import type { ShareReads } from './opening'
import ShareBody from './ShareBody.vue'
import ShareDialogFooter from './ShareDialogFooter.vue'
import ShareDialogHeader from './ShareDialogHeader.vue'
import { accessLossMessage } from './shareFormat'
import { isOpen } from './shareModel'
import { useShare } from './useShare'

const props = defineProps<{
  node: string
  /** The node as the opener last read it, shown at once. */
  known?: DriveNode
  /** The reads the opener already started, which stand in for the dialog's first read. */
  reads?: ShareReads
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ 'after-leave': []; changed: [value: boolean] }>()

const isPhone = useMediaQuery('(max-width: 767px)')
// While people wait to be added, Share is the one solid action.
const picked = ref(0)
const body = useTemplateRef<HTMLElement>('body')
const pickingHeight = ref(0)
// The picker takes the place of the access list and the actions, so the dialog
// keeps the height it had. Measured before the DOM swaps the two views.
watch(
  () => picked.value > 0,
  (picking) => {
    if (!picking || !body.value) return
    const actions = body.value
      .closest('[data-slot="content"]')
      ?.querySelector<HTMLElement>(':scope > [data-slot="actions"]')
    pickingHeight.value = body.value.offsetHeight + (actions?.offsetHeight ?? 0)
  },
  { flush: 'pre' },
)
const session = useSession()
const { workspaceName } = useWorkspace()
const state = useShare(props.node, {
  me: session.user.value?.id,
  confirmLoss: (after) => {
    const suiteAdmin = !!session.capabilities.value.suiteAdmin
    // A Suite Admin who keeps Edit loses nothing: they still share through their admin role.
    if (suiteAdmin && after >= DRIVE_ROLES.edit) return Promise.resolve(true)
    return confirm({
      title: __('Change your own access?'),
      message: accessLossMessage(after, state.node.value?.kind ?? 'file', suiteAdmin),
      confirmLabel: __('Change'),
      destructive: true,
    })
  },
  workspace: workspaceName,
  placeTitle: useLocationTitle(),
  known: props.known,
  reads: props.reads,
})
// While the node is unknown, its header and Copy link hold their place.
const placeholders = computed(() => !state.loadError.value)

// People picked but not yet shared are lost on closing, so closing asks first
async function setOpen(next: boolean) {
  if (next || !picked.value || (await confirmDiscard())) open.value = next
}

function confirmDiscard() {
  return confirm({
    title:
      picked.value === 1
        ? __('Discard 1 person?')
        : __('Discard {0} people?', [String(picked.value)]),
    message: __('They haven’t been added yet.'),
    confirmLabel: __('Discard'),
    destructive: true,
  })
}

/** The item's own address. It opens for people with access; Share links reach anyone. */
const address = computed(() => {
  const current = state.node.value
  if (!current) return null

  const { name, title, kind } = current
  return driveNodeRoute(name, title, kind === 'root' ? 'folder' : kind).path
})
/** Who the item's own address opens for. Public viewers open it too, so it is the public link. */
const caption = computed(() =>
  isOpen(state.sections.value?.public ?? null)
    ? __('Anyone with the link can view')
    : __('For people with access'),
)

onMounted(() => void state.load())
// The opener refreshes what it shows when a write went through.
watch(state.changed, (value) => value && emit('changed', true))
</script>
