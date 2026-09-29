<template>
  <!-- A locked link must not leak the item: no title, owner or kind (spec §10.2). -->
  <section class="flex min-h-full w-full items-center justify-center px-5 py-16" aria-labelledby="drive-unlock-title">
    <form class="w-full max-w-sm text-center" @submit.prevent="open">
      <div class="mx-auto grid size-12 place-items-center rounded-full bg-surface-gray-2 text-ink-gray-5">
        <span class="lucide-lock-keyhole size-6" aria-hidden="true" />
      </div>
      <h1 id="drive-unlock-title" class="mt-4 text-2xl-semibold text-ink-gray-9">Password required</h1>
      <p class="mt-2 text-p-base text-ink-gray-6">Enter the password to open this link.</p>
      <div ref="field" class="mt-6 flex items-start gap-2 text-left">
        <FormControl
          v-model="form.password.value"
          class="flex-1"
          type="password"
          aria-label="Password"
          placeholder="Password"
          autocomplete="current-password"
          :disabled="form.disabled.value"
        />
        <Button
          type="submit"
          variant="solid"
          theme="gray"
          label="Open"
          :loading="form.pending.value"
          :disabled="form.disabled.value || !form.password.value"
        />
      </div>
      <!-- One reserved line, so the error and the countdown do not move the form. -->
      <p class="mt-2 h-5 text-left text-p-sm text-ink-red-7" role="status" aria-live="polite" data-testid="drive-unlock-message">
        {{ form.message.value }}
      </p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { Button, FormControl } from 'frappe-ui'
import { onMounted, useTemplateRef } from 'vue'

import { useUnlockForm } from './unlockForm'

const props = defineProps<{ node: string }>()
const emit = defineEmits<{ unlocked: [] }>()

const form = useUnlockForm(() => props.node)
const field = useTemplateRef<HTMLElement>('field')

// The password is the only thing to do here.
onMounted(() => field.value?.querySelector('input')?.focus())

async function open() {
  if (await form.submit()) emit('unlocked')
}
</script>
