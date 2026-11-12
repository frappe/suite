<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed } from 'vue'

import { confirm, Dropdown, toast } from '@/platform/feedback'

import {
  copyToClipboard,
  discardCopy,
  downloadCopy,
  savedAtLabel,
  type RecoveryCopy,
} from './copies'

/**
 * A recovery copy's menu: view it where `canView`, leave it where `canGoBack`,
 * copy it, download it or discard it.
 */
const props = defineProps<{ copy: RecoveryCopy; canView?: boolean; canGoBack?: boolean }>()
const emit = defineEmits<{ view: []; back: []; discarded: [] }>()

const viewOption = { label: 'View', icon: 'lucide-eye', onClick: () => emit('view') }
const backOption = {
  label: 'Back to current',
  icon: 'lucide-arrow-left',
  onClick: () => emit('back'),
}
const copyOptions = [
  { label: 'Copy', icon: 'lucide-copy', onClick: copyText },
  { label: 'Download', icon: 'lucide-download', onClick: download },
  { label: 'Discard', icon: 'lucide-trash-2', theme: 'red' as const, onClick: discard },
]
const options = computed(() => [...leadingOptions(), ...copyOptions])

function leadingOptions() {
  const leading = []
  if (props.canGoBack) {
    leading.push(backOption)
  }

  if (props.canView) {
    leading.push(viewOption)
  }

  return leading
}

async function copyText() {
  try {
    await copyToClipboard(props.copy)
  } catch {
    toast.error("Couldn't copy. Download it instead.")
    return
  }

  toast.success('Copied')
}

function download() {
  downloadCopy(props.copy)
}

async function discard() {
  const isConfirmed = await confirm({
    title: 'Discard recovery copy?',
    message: "This deletes the copy from this device. It can't be brought back.",
    confirmLabel: 'Discard',
    destructive: true,
  })
  if (!isConfirmed) {
    return
  }

  await discardCopy(props.copy)
  emit('discarded')
}
</script>

<template>
  <Dropdown :options="options" align="end">
    <Button
      icon="lucide-ellipsis"
      variant="ghost"
      :aria-label="`Actions for the copy from ${savedAtLabel(copy)}`"
      @click.stop
    />
  </Dropdown>
</template>
