<template>
  <!-- An account an Admin created directly that did not finish. Nobody was invited, so only
       Retry or Remove can settle it. -->
  <div class="flex gap-2">
    <Button
      :label="__('Retry')"
      :loading="retry.isPending"
      :disabled="retry.isPending || remove.isPending"
      @click="retrySubmit"
    />
    <Button
      variant="ghost"
      theme="red"
      :label="__('Remove')"
      :disabled="retry.isPending || remove.isPending"
      @click="removing = true"
    />
  </div>
  <Dialog
    v-model:open="removing"
    :title="__('Remove account')"
    :message="
      __(
        'Remove {0}? Its unused user and anything the failed setup made are deleted, so the address can be added again.',
        [request.account],
      )
    "
    :actions="[
      {
        label: __('Remove'),
        variant: 'solid',
        theme: 'red',
        loading: remove.isPending,
        onClick: removeSubmit,
      },
    ]"
  />
  <Dialog
    :open="!!temporaryPassword"
    :title="__('Account added')"
    @update:open="(open: boolean) => !open && (temporaryPassword = '')"
  >
    <template #default>
      <div class="space-y-4">
        <p class="text-base text-ink-gray-7">
          {{
            __(
              'Share this temporary password privately with the new user. It is shown once, expires after seven days, and cannot be used by Mail clients. The user must change it before normal access.',
            )
          }}
        </p>
        <FormControl :value="temporaryPassword" readonly :label="__('Temporary password')" />
        <Button :label="__('I have saved it securely')" @click="temporaryPassword = ''" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { ref } from 'vue'

import { api, useMutation } from '@/api'
import { raiseToast } from '@/apps/mail/utils'
import { translate as __ } from '@/platform/translation'

const props = defineProps<{ request: { name: string; account: string } }>()
const emit = defineEmits<{ settled: [] }>()

const temporaryPassword = ref('')
const retry = useMutation(api.mail.admin.members.retryCreation)
async function retrySubmit() {
  const result = await retry.run({ name: props.request.name })
  emit('settled')
  if (!result.success) return raiseToast(result.error || __('Account setup failed again.'), 'error')
  temporaryPassword.value = result.temporary_password || ''
  if (!temporaryPassword.value) raiseToast(__('Account added.'))
}

const removing = ref(false)
const remove = useMutation(api.mail.admin.members.removeFailedCreation)
async function removeSubmit() {
  await remove.run({ name: props.request.name })
  removing.value = false
  raiseToast(__('Account removed.'))
  emit('settled')
}
</script>
