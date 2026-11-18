<template>
  <Dialog v-if="selected" v-model:open="show" v-bind="addSignatureOptions">
    <template #default>
      <div v-if="draft" class="space-y-4">
        <FormControl
          v-model="draft.signature_name"
          :label="__('Name')"
          :placeholder="__('Work signature')"
          variant="outline"
        />
        <div class="space-y-1.5">
          <label class="text-ink-gray-5 block text-xs">{{ __('Signature') }}</label>
          <MailRichTextField
            v-model="draft.html_body"
            :placeholder="__('Write your signature here')"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { computed } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import { toast } from '@/platform/feedback'
import { useSettingsDraft } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const show = defineModel<boolean>()

const { signatureID } = defineProps<{ signatureID: string }>()

const emit = defineEmits(['reloadSignatures'])

const signatures = useQuery(api.mail.signatures.list, () => (show.value ? {} : false))
const selected = computed(() =>
  signatures.data?.find((signature) => signature.name === signatureID),
)
// While the dialog is open, a reload of the signature list leaves a changed draft alone.
const { draft, dirty } = useSettingsDraft(() =>
  show.value && selected.value
    ? { signature_name: selected.value.signature_name, html_body: selected.value.html_body ?? '' }
    : null,
)
const updateSignature = useMutation(api.mail.signatures.update)
async function save() {
  if (!draft.value) return
  await updateSignature.run({ name: signatureID, ...draft.value })
  show.value = false
  toast.success(__('Signature updated'))
  emit('reloadSignatures')
}

const addSignatureOptions = computed(() => ({
  title: __('Edit signature'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !dirty.value || !draft.value?.signature_name || !draft.value.html_body,
      onClick: () => save(),
    },
  ],
}))
</script>
