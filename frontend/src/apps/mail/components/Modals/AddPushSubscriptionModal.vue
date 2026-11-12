<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('New Push Subscription'),
      actions: [
        {
          label: __('Create'),
          variant: 'solid' as const,
          disabled: !canCreate,
          loading: addPushSubscription.isPending,
          onClick: addPushSubscriptionSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="url"
          type="text"
          variant="outline"
          :label="__('URL')"
          placeholder="https://example.com/push"
          :description="
            __(
              'Where the JMAP server sends push messages. Leave blank to use this app\'s default endpoint. Must start with https://.',
            )
          "
        />
        <FormControl
          v-model="deviceClientId"
          type="text"
          variant="outline"
          :label="__('Device Client ID')"
          :placeholder="__('Auto-generated if left blank')"
          :description="__('Uniquely identifies the client and device.')"
        />
        <FormControl
          v-model="types"
          type="text"
          variant="outline"
          :label="__('Types')"
          placeholder="Email, Mailbox"
          :description="
            __(
              'Comma-separated list of types to be notified for. Leave blank to be notified for all supported types.',
            )
          "
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { computed, inject, ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const emit = defineEmits<{
  created: []
}>()
const user = inject('$user')
const url = ref('')
const deviceClientId = ref('')
const types = ref('')

// Blank means no types are sent at all — the server then subscribes to every supported type.
const chosenTypes = computed(() =>
  types.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
)

// A URL is optional (blank falls back to the app default), but if given it must be an https URL to
// match the backend's validation.
const canCreate = computed(() => !url.value.trim() || url.value.trim().startsWith('https://'))
const addPushSubscription = useMutation(api.mail.push.create)
async function addPushSubscriptionSubmit() {
  const input: InputOf<typeof api.mail.push.create> = {
    user: user.data.name,
    url: url.value.trim() || undefined,
    device_client_id: deviceClientId.value.trim() || undefined,
    types: chosenTypes.value.length ? chosenTypes.value : undefined,
  }
  await addPushSubscription.run(input)
  raiseToast(__('Push subscription created.'))
  show.value = false
  emit('created')
}

// Reset the form each time the dialog opens.
watch(show, (open) => {
  if (!open) return
  url.value = ''
  deviceClientId.value = ''
  types.value = ''
})
</script>
