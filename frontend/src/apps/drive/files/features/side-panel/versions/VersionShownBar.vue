<script setup lang="ts">
import { Button } from 'frappe-ui'

import type { DocumentVersion } from '@/apps/drive'
import { versionTitle } from '@/platform/collab/versionDates'

import DocumentStrip from '../../DocumentStrip.vue'

/** The line over a version shown in the document's place: its name, Restore and Back to current. */
defineProps<{
  version: DocumentVersion
  canRestore: boolean
  isRestoring: boolean
}>()
const emit = defineEmits<{ restore: [version: DocumentVersion]; back: [] }>()
</script>

<template>
  <DocumentStrip>
    <p class="truncate">{{ __('Viewing {0}', [versionTitle(version)]) }}</p>
    <div class="flex shrink-0 items-center gap-1">
      <Button
        v-if="canRestore"
        size="sm"
        variant="ghost"
        icon="lucide-undo-2"
        :tooltip="__('Restore this version')"
        :aria-label="__('Restore this version')"
        :disabled="isRestoring"
        @click="emit('restore', version)"
      />
      <Button
        size="sm"
        variant="subtle"
        :label="__('Back to current')"
        :tooltip="__('Back to the current version (Esc)')"
        @click="emit('back')"
      />
    </div>
  </DocumentStrip>
</template>
