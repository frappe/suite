<script setup lang="ts">
import { Button, Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import { versionByline, versionTitle, type VersionPreview } from './versions'

/** The strip above a version shown read-only: what it is, its changed cells, and what can be done with it. */
const props = defineProps<{
  preview: VersionPreview
  /** The changed cell last stepped to; null before the first step. */
  step: number | null
  writable: boolean
  canCopy: boolean
  restoring: boolean
}>()
const emit = defineEmits<{
  exit: []
  step: [delta: 1 | -1]
  rename: []
  copy: []
  restore: []
}>()

const count = computed(() => props.preview.changes?.length ?? 0)
const changesText = computed(() => {
  if (!props.preview.changes) return __("Changed cells can't be listed for this version")
  if (!count.value) return __('No cells differ from the current version')
  if (count.value === 1) return __('1 cell differs from the current version')
  return __('{0} cells differ from the current version', [String(count.value)])
})
const stepText = computed(() =>
  props.step === null ? '' : __('{0} of {1}', [String(props.step + 1), String(count.value)]),
)
</script>

<template>
  <div
    class="flex min-h-[41px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-outline-gray-1 bg-surface-gray-2 px-3 py-1.5 text-sm text-ink-gray-7"
    role="status"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <Tooltip :text="__('Back to the current version')">
        <Button
          icon="lucide-arrow-left"
          variant="ghost"
          size="sm"
          :aria-label="__('Back to the current version')"
          @click="emit('exit')"
        />
      </Tooltip>
      <p class="min-w-0 truncate">
        <span class="text-ink-gray-8">{{ versionTitle(preview.version) }}</span>
        <span class="text-ink-gray-5"> · {{ versionByline(preview.version) }}</span>
      </p>
    </div>
    <div class="flex items-center gap-1">
      <span class="text-ink-gray-6">{{ changesText }}</span>
      <template v-if="count">
        <Button
          icon="lucide-chevron-up"
          variant="ghost"
          size="sm"
          :aria-label="__('Previous changed cell')"
          @click="emit('step', -1)"
        />
        <span v-if="stepText" class="min-w-12 text-center tabular-nums text-ink-gray-6">
          {{ stepText }}
        </span>
        <Button
          icon="lucide-chevron-down"
          variant="ghost"
          size="sm"
          :aria-label="__('Next changed cell')"
          @click="emit('step', 1)"
        />
      </template>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <Button
        v-if="writable"
        size="sm"
        variant="ghost"
        icon-left="lucide-pencil"
        :label="preview.version.label ? __('Rename') : __('Name this version')"
        @click="emit('rename')"
      />
      <Button
        v-if="canCopy"
        size="sm"
        variant="ghost"
        icon-left="lucide-copy"
        :label="__('Make a copy')"
        @click="emit('copy')"
      />
      <Button
        v-if="writable"
        size="sm"
        variant="solid"
        :label="__('Restore this version')"
        :loading="restoring"
        @click="emit('restore')"
      />
    </div>
  </div>
</template>
