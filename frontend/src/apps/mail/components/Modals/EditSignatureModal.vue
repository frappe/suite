<template>
  <Dialog v-if="selected" v-model:open="show" v-bind="addSignatureOptions">
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="draft.signature_name"
          :label="__('Signature Name')"
          :placeholder="__('Work signature')"
          variant="outline"
        />
        <div class="space-y-1.5">
          <label class="text-ink-gray-5 block text-xs">{{ __('Signature Body') }}</label>
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
import { computed, reactive, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()

const { signatureID } = defineProps<{ signatureID: string }>()

const emit = defineEmits(['reloadSignatures'])

const signatures = useQuery(api.mail.signatures.list, () => (show.value ? {} : false))
const selected = computed(() =>
  signatures.data?.find((signature) => signature.name === signatureID),
)
const draft = reactive({ signature_name: '', html_body: '' })
watch(
  selected,
  (signature) => {
    if (signature)
      Object.assign(draft, {
        signature_name: signature.signature_name,
        html_body: signature.html_body ?? '',
      })
  },
  { immediate: true },
)
const updateSignature = useMutation(api.mail.signatures.update)
async function save() {
  await updateSignature.run({ name: signatureID, ...draft })
  show.value = false
  raiseToast(__('Signature updated.'))
  emit('reloadSignatures')
}

const addSignatureOptions = computed(() => ({
  title: __('Edit Signature'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !draft.signature_name || !draft.html_body,
      onClick: () => save(),
    },
  ],
}))
</script>
