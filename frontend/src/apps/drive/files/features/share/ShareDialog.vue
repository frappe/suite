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
      <ShareBody v-model:picked="picked" :state="state" />
      <div v-if="!picked" class="mt-5 flex items-center gap-2 border-t border-outline-gray-1 pt-4">
        <div v-if="address" class="min-w-0">
          <Button icon-left="lucide-link" :label="__('Copy link')" @click="copyLink(address)" />
          <p class="mt-1.5 text-p-xs text-ink-gray-5">{{ __('For people with access') }}</p>
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
      <ShareBody v-model:picked="picked" :state="state" autofocus-picker />
    </div>
    <template v-if="!picked" #actions>
      <div v-if="captionedFooter" class="flex items-center justify-between gap-2">
        <div v-if="address" class="min-w-0">
          <Button icon-left="lucide-link" :label="__('Copy link')" @click="copyLink(address)" />
          <p class="mt-1.5 text-p-xs text-ink-gray-5">{{ __('For people with access') }}</p>
        </div>
        <Button class="ml-auto" variant="ghost" :label="__('Done')" @click="open = false" />
      </div>
      <div v-else class="flex justify-between gap-2">
        <div v-if="address" class="min-w-0">
          <Button icon-left="lucide-link" :label="__('Copy link')" @click="copyLink(address)" />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { BottomSheet, Button, Dialog } from 'frappe-ui'
import { computed, onMounted, ref, watch } from 'vue'

import { api, useQuery } from '@/api'
import { driveNodeRoute } from '@/apps/drive'
import { confirm } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { useTweak } from '@/platform/tweaks'

import { nodeIcon, nodeIconTint } from '../../internal/icons'
import { useLocationTitle } from '../../internal/locations'
import ShareBody from './ShareBody.vue'
import { copyLink } from './shareFormat'
import { useShare } from './useShare'

const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ 'after-leave': []; changed: [value: boolean] }>()

const isPhone = useMediaQuery('(max-width: 767px)')
const captionedFooter = useTweak('t10')
// While people wait to be added, Share is the one solid action.
const picked = ref(0)
const session = useSession()
// The server page boots the workspace name. The Vite dev page does not, so the dialog asks the site.
const site = useQuery(api.suite.site.get, () =>
  window.suite_workspace_name === undefined ? {} : false,
)
const state = useShare(props.node, {
  me: session.user.value?.id,
  confirmLoss: () =>
    confirm({
      title: 'Change your own access?',
      message: 'You will no longer be able to share this item.',
      confirmLabel: 'Change',
      destructive: true,
    }),
  workspace: () => window.suite_workspace_name ?? site.data?.workspace_name,
  placeTitle: useLocationTitle(),
})

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

onMounted(() => void state.load())
// The opener refreshes what it shows when a write went through.
watch(state.changed, (value) => value && emit('changed', true))
</script>
