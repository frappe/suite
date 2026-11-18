<!--
  A Settings form with several text fields that save together. A single
  switch, select or combobox saves on change in a `SettingsRow` instead, with
  no form and no Save button.

  The fields go in the default slot. Save sits under them, right-aligned, so
  it is next to what it saves and lines up with the controls of the rows
  above. It stays off until `dirty` is true, and shows a pending state while
  `save` runs. Enter in a field saves too.

  `save` owns its own feedback: a toast on success, and on failure either a
  rejection (the default error toast) or its own message.
-->
<template>
  <form class="flex flex-col gap-4 pt-2" @submit.prevent="submit">
    <slot />
    <div class="flex justify-end">
      <Button
        type="submit"
        variant="solid"
        :label="__('Save')"
        :disabled="!dirty"
        :loading="saving"
      />
    </div>
  </form>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { ref } from 'vue'

import { translate as __ } from '@/platform/translation'

const props = defineProps<{
  /** Whether a field differs from what is saved. */
  dirty: boolean
  save: () => Promise<unknown>
}>()
defineSlots<{ default?: () => unknown }>()

const saving = ref(false)

async function submit() {
  if (!props.dirty || saving.value) return
  saving.value = true
  try {
    await props.save()
  } finally {
    saving.value = false
  }
}
</script>
