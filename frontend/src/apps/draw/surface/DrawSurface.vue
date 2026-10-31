<script setup lang="ts">
import { Button } from 'frappe-ui'
import { onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'

import { driveNodeRoute, useDriveDocumentCreation, type DocumentSession } from '@/apps/drive'
import { translate as __ } from '@/platform/translation'

import DrawEditor from '../App.vue'
import { DRAWING_PERSISTENCE, DrawingPersistence } from '../canvas/persistence'

const props = defineProps<{ session: DocumentSession }>()
const router = useRouter()
const creation = useDriveDocumentCreation()
const recovering = ref(false)
const persistence = new DrawingPersistence(props.session)
provide(DRAWING_PERSISTENCE, persistence)
const editor = ref<InstanceType<typeof DrawEditor> | null>(null)
const {
  dirty,
  saving,
  error,
  conflict,
  loadError,
  editable,
  recoveryAvailable,
  recoveryAllowed,
  drawingLoading,
  readable,
} = persistence

function reload() {
  location.reload()
}
async function saveRecoveredCopy() {
  recovering.value = true
  try {
    const node = await creation.run({ content_doctype: 'Drawing' })
    await persistence.saveRecoveryTo(node.name)
    await router.push(driveNodeRoute(node))
  } catch (reason) {
    error.value =
      reason instanceof Error ? reason.message : __('Could not save the recovered drawing.')
  } finally {
    recovering.value = false
  }
}

async function leave(): Promise<boolean> {
  await editor.value?.flush()
  await persistence.saveDrawing()
  if (!dirty.value) return true
  await persistence.retainRecovery()
  return window.confirm(
    recoveryAvailable.value
      ? __('Your latest changes are kept as a recovery copy. Leave this drawing?')
      : __(
          'Recovery storage is unavailable. Download your draft before leaving. Leave this drawing?',
        ),
  )
}

onBeforeRouteLeave(leave)
onBeforeRouteUpdate((to, from) => (to.params.node === from.params.node ? true : leave()))
watch(drawingLoading, (loading) => {
  if (!loading && dirty.value && editable.value) void persistence.saveDrawing()
})
watch(readable, (value) => {
  if (!value) void persistence.retainRecovery()
})
onMounted(() => window.addEventListener('online', persistence.saveDrawing))
onBeforeUnmount(() => {
  window.removeEventListener('online', persistence.saveDrawing)
  persistence.dispose()
})
</script>

<template>
  <div class="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-base text-ink-gray-8">
    <div v-if="!readable" class="m-auto px-6 text-center" role="alert">
      {{ __('You no longer have permission to read this drawing.') }}
      <Button
        v-if="dirty && recoveryAllowed"
        :label="__('Download recovery')"
        @click="persistence.downloadRecovery"
      />
    </div>
    <template v-else>
      <div
        v-if="error || conflict || !recoveryAvailable"
        class="flex flex-wrap items-center gap-2 border-b border-outline-gray-2 px-3 py-2 text-sm"
        role="alert"
      >
        <span>{{
          error ||
          (conflict
            ? __('The saved drawing changed. Your recovery draft is preserved.')
            : __('Recovery storage is unavailable. Keep this tab open.'))
        }}</span>
        <Button
          v-if="dirty"
          :label="__('Download recovery')"
          @click="persistence.downloadRecovery"
        />
        <Button
          v-if="dirty && conflict"
          :label="__('Save recovered copy')"
          :loading="recovering"
          @click="saveRecoveredCopy"
        />
        <Button
          v-if="!conflict && !loadError"
          :label="__('Retry save')"
          :loading="saving"
          :disabled="!editable"
          @click="persistence.saveDrawing"
        />
        <Button v-if="loadError" :label="__('Reload')" @click="reload" />
      </div>
      <div
        v-if="!editable && !drawingLoading && !loadError"
        class="px-3 py-1 text-sm text-ink-gray-6"
        role="status"
      >
        {{ conflict ? __('Recovery preview · editing paused') : __('View only') }}
      </div>
      <DrawEditor ref="editor" class="min-h-0 flex-1" />
    </template>
  </div>
</template>
