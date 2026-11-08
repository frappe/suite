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
      <div v-if="state.node.value" class="mb-6 flex items-center gap-2.5">
        <span
          :class="[nodeIcon(state.node.value), 'size-5 shrink-0', nodeIconTint(state.node.value)]"
          aria-hidden="true"
        />
        <p class="min-w-0 break-words text-p-base-medium text-ink-gray-8">
          {{ state.node.value.title }}
        </p>
      </div>
      <div v-else-if="placeholders" class="mb-6 flex items-center gap-2.5" aria-hidden="true">
        <Skeleton class="size-5 shrink-0" />
        <p class="text-p-base-medium"><Skeleton class="inline-block h-4 w-48 align-middle" /></p>
      </div>
      <ShareBody v-model:picked="picked" :state="state" />
      <div v-if="!picked" class="mt-5 flex items-center gap-2 border-t border-outline-gray-1 pt-4">
        <div v-if="address" class="min-w-0">
          <Button icon-left="lucide-link" :label="__('Copy link')" @click="copyLink(address)" />
          <p class="mt-1.5 text-p-xs text-ink-gray-5">{{ caption }}</p>
        </div>
        <div v-else-if="placeholders" class="min-w-0" aria-hidden="true">
          <Skeleton class="h-7 w-28" />
          <p class="mt-1.5 text-p-xs"><Skeleton class="inline-block h-3 w-32 align-middle" /></p>
        </div>
        <Button class="ml-auto" variant="ghost" :label="__('Done')" @click="open = false" />
      </div>
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
      class="-mx-1 -mt-5 px-1"
      :class="{ 'max-h-[min(36rem,calc(100dvh_-_16rem))] overflow-y-auto': !picked }"
    >
      <div v-if="state.node.value" class="mb-6 flex items-center gap-2.5">
        <span
          :class="[nodeIcon(state.node.value), 'size-5 shrink-0', nodeIconTint(state.node.value)]"
          aria-hidden="true"
        />
        <p class="min-w-0 break-words text-p-base-medium text-ink-gray-8">
          {{ state.node.value.title }}
        </p>
      </div>
      <div v-else-if="placeholders" class="mb-6 flex items-center gap-2.5" aria-hidden="true">
        <Skeleton class="size-5 shrink-0" />
        <p class="text-p-base-medium"><Skeleton class="inline-block h-4 w-48 align-middle" /></p>
      </div>
      <ShareBody v-model:picked="picked" :state="state" autofocus-picker />
    </div>
    <template v-if="!picked" #actions>
      <div class="flex items-center justify-between gap-2">
        <div v-if="address" class="min-w-0">
          <Button icon-left="lucide-link" :label="__('Copy link')" @click="copyLink(address)" />
          <p class="mt-1.5 text-p-xs text-ink-gray-5">{{ caption }}</p>
        </div>
        <div v-else-if="placeholders" class="min-w-0" aria-hidden="true">
          <Skeleton class="h-7 w-28" />
          <p class="mt-1.5 text-p-xs"><Skeleton class="inline-block h-3 w-32 align-middle" /></p>
        </div>
        <Button class="ml-auto" variant="ghost" :label="__('Done')" @click="open = false" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { BottomSheet, Button, Dialog, Skeleton } from 'frappe-ui'
import { computed, onMounted, ref, watch } from 'vue'

import { driveNodeRoute } from '@/apps/drive'
import { DRIVE_ROLES, type DriveNode } from '@/apps/drive/client/types'
import { confirm } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { useWorkspace } from '@/platform/workspace'

import { nodeIcon, nodeIconTint } from '../../internal/icons'
import { useLocationTitle } from '../../internal/locations'
import ShareBody from './ShareBody.vue'
import { accessLossMessage, copyLink } from './shareFormat'
import { isOpen } from './shareModel'
import { useShare } from './useShare'

const props = defineProps<{
  node: string
  /** The node as the opener last read it, shown at once. */
  known?: DriveNode
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ 'after-leave': []; changed: [value: boolean] }>()

const isPhone = useMediaQuery('(max-width: 767px)')
// While people wait to be added, Share is the one solid action.
const picked = ref(0)
const session = useSession()
const { workspaceName } = useWorkspace()
const state = useShare(props.node, {
  me: session.user.value?.id,
  confirmLoss: ({ after }) => {
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
