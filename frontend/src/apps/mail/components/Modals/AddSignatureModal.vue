<template>
  <Dialog v-model:open="show" v-bind="addSignatureOptions">
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

import { api, useMutation } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()

const emit = defineEmits(['reloadSignatures'])

const defaultSignature = { signature_name: '', html_body: '' }
const draft = reactive({ ...defaultSignature })
const createSignature = useMutation(api.mail.signatures.create)
async function save() {
  await createSignature.run({ ...draft })
  show.value = false
  raiseToast(__('Signature created.'))
  emit('reloadSignatures')
}

const addSignatureOptions = computed(() => ({
  title: __('New Signature'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !draft.signature_name || !draft.html_body,
      onClick: () => save(),
    },
  ],
}))

watch(show, (val) => {
  if (val) Object.assign(draft, defaultSignature)
})
</script>
