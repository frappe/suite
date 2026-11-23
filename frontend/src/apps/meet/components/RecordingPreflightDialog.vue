<script setup lang="ts">
import { Alert, Dialog, Switch } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

import {
  captureLabel,
  defaultCaptureOptions,
  type CaptureOptions,
} from '../utils/capturePresentation'
import { refusalOr } from '../utils/error'

const props = defineProps<{
  confirm: (options: CaptureOptions) => Promise<unknown>
  e2ee?: boolean
}>()
const open = defineModel<boolean>('open', { default: false })
const options = ref(defaultCaptureOptions())
const starting = ref(false)
const startError = ref('')
watch(open, (value) => {
  if (value) {
    options.value = defaultCaptureOptions()
    startError.value = ''
  }
})
watch(
  options,
  () => {
    startError.value = ''
  },
  { deep: true },
)
const selected = computed(() => options.value.video_enabled || options.value.transcription_enabled)
const canStart = computed(() => selected.value && !starting.value && !props.e2ee)
const actions = computed(() => [
  {
    label: __('Start {0}', [captureLabel(options.value).toLowerCase()]),
    variant: 'solid' as const,
    disabled: !canStart.value,
    loading: starting.value,
    onClick: async ({ close }: { close: () => void }) => {
      if (!canStart.value) return
      starting.value = true
      startError.value = ''
      try {
        const result = await props.confirm({ ...options.value })
        if (
          result &&
          typeof result === 'object' &&
          'status' in result &&
          result.status === 'Rejected'
        )
          return
        close()
      } catch (error) {
        startError.value = refusalOr(error, __('Could not start capture'))
      } finally {
        starting.value = false
      }
    },
  },
  {
    label: __('Cancel'),
    disabled: starting.value,
    onClick: ({ close }: { close: () => void }) => close(),
  },
])
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="__('Capture')"
    size="md"
    :actions="actions"
    :dismissible="!starting"
  >
    <div class="space-y-4">
      <Switch
        v-model="options.video_enabled"
        :label="__('Record video')"
        :disabled="starting || e2ee"
      />
      <Switch
        v-model="options.transcription_enabled"
        :label="__('Transcribe speech')"
        :disabled="starting || e2ee"
      />
      <p class="text-p-base text-ink-gray-7">
        {{
          __(
            "Everyone will be notified. The selected outputs will be saved privately to the room owner's Drive.",
          )
        }}
      </p>
      <Alert
        v-if="e2ee"
        theme="red"
        :title="__('Capture is unavailable in end-to-end encrypted meetings')"
      />
      <Alert v-else-if="startError" theme="red" :title="startError" />
    </div>
  </Dialog>
</template>
