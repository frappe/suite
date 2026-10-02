<template>
  <div class="group/card relative flex w-full min-w-0 select-none">
    <!-- `as` is the card's own control, a button or a link. Listeners and
         attributes land on it, not on this wrapper. -->
    <component
      :is="tag"
      :type="tag === 'button' ? 'button' : undefined"
      v-bind="$attrs"
      class="relative flex aspect-[1.7] w-full min-w-0 flex-col items-start gap-3 overflow-hidden rounded-5 border p-3 text-start transition-colors focus-visible:focus-ring"
      :class="selected ? 'border-outline-gray-3 bg-surface-gray-2' : 'border-outline-gray-1 bg-surface-elevation-1 group-hover/card:border-outline-gray-2 group-hover/card:bg-surface-gray-1 dark:group-hover/card:bg-surface-elevation-2'"
    >
      <!-- The preview fills the space above the name, edge to edge, where the
           icon would be. It shows only once it has loaded, so a slow or failed
           preview leaves the plain card. -->
      <span class="relative -mx-3 -mt-3 min-h-0 w-[calc(100%+1.5rem)] flex-1 px-3 pt-3">
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt=""
          class="absolute inset-0 size-full border-b border-outline-gray-1 object-cover transition-opacity"
          :class="[onImage ? 'opacity-100' : 'opacity-0', isDocument && 'object-top']"
          @load="previewLoaded"
          @error="onPreviewError"
        />
        <span
          class="relative block size-4.5"
          :class="[nodeIcon(node), nodeIconTint(node), onImage && 'invisible']"
          aria-hidden="true"
        />
      </span>
      <span class="relative flex w-full min-w-0 flex-col gap-1.5">
        <span class="flex w-full min-w-0 items-center">
          <span class="truncate text-base font-medium text-ink-gray-8" :title="node.title">{{ node.title }}</span>
          <span v-if="node.favourite" class="lucide-star ml-1.5 size-3.5 shrink-0 text-ink-amber-6" aria-hidden="true" />
        </span>
        <span class="flex min-w-0 items-center gap-1 text-xs text-ink-gray-5">
          <slot name="meta"><span class="truncate">{{ meta }}</span></slot>
        </span>
      </span>
      <!-- Overlays that belong to the control, such as a selection checkbox. -->
      <slot />
    </component>
    <!-- Controls of their own, such as a menu button, sit beside the card's control.
         `onImage` is true when the control sits over the preview. -->
    <slot name="actions" :on-image="onImage" />
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import { nodeIcon, nodeIconTint } from '@/apps/drive/files/internal/icons'
import { useNodePreview } from './nodePreview'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** The card's control. Defaults to a button. */
  as?: string | Component
  /** The file the card shows. Pass rows fetched with `expand=preview` for thumbnails. */
  node: Pick<DriveNode, 'name' | 'title' | 'kind' | 'mime' | 'content_doctype' | 'preview' | 'favourite'>
  meta?: string
  selected?: boolean
}>()
const emit = defineEmits<{
  /** A thumbnail failed to load. Refetch the node for a fresh signed URL. Emitted once per file. */
  'preview-error': []
}>()

const tag = computed(() => props.as ?? 'button')
const { url: previewUrl, shown: onImage, loaded: previewLoaded, failed: previewFailed } = useNodePreview(() => props.node)
// A page reads from its top, where its title is; a photo reads best from its middle.
const isDocument = computed(() => props.node.mime === 'application/pdf')

function onPreviewError() {
  if (previewFailed()) emit('preview-error')
}
</script>
