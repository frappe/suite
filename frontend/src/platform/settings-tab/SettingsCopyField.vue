<!--
  A read-only value with a copy button: connection details such as a server
  URL, a username or an API key. Stack several in a `SettingsSection`, or put
  them in a dialog.
-->
<template>
  <div class="flex flex-col gap-1.5 py-2">
    <label :for="id" class="text-sm text-ink-gray-6">{{ label }}</label>
    <div class="flex items-center gap-2">
      <TextInput :id="id" class="min-w-0 flex-1" :model-value="value" readonly />
      <Button icon="lucide-copy" :aria-label="__('Copy {0}', [label])" @click="copyValue(value)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, TextInput } from 'frappe-ui'
import { useId } from 'vue'

import { translate as __ } from '@/platform/translation'

import { copyValue } from './copyValue'

defineProps<{ label: string; value: string }>()
const id = useId()
</script>
