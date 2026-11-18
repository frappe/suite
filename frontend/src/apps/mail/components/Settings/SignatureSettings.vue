<template>
  <!-- One signature, written in place of the list: the arrow goes back to it -->
  <div v-if="draft" class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <Button
        variant="ghost"
        icon="lucide-arrow-left"
        :aria-label="__('Back to signatures')"
        @click="showList"
      />
      <h3 class="text-base-medium text-ink-gray-8">{{ formTitle }}</h3>
    </div>
    <FormControl
      v-model="draft.signature_name"
      :label="__('Name')"
      :placeholder="__('Work signature')"
      variant="outline"
    />
    <div class="space-y-1.5">
      <label class="text-ink-gray-5 block text-xs">{{ __('Signature') }}</label>
      <MailRichTextField v-model="draft.html_body" :placeholder="__('Write your signature here')" />
    </div>
    <SettingsDialogActions>
      <Button
        variant="solid"
        :label="__('Save')"
        :size="buttonSize"
        :disabled="isSaveBlocked"
        :loading="isSaving"
        @click="save"
      />
    </SettingsDialogActions>
  </div>
  <div v-else class="flex flex-col gap-3">
    <SettingsDialogActions>
      <Button
        variant="solid"
        icon-left="lucide-plus"
        :label="__('New signature')"
        :size="buttonSize"
        @click="addSignature"
      />
    </SettingsDialogActions>
    <div v-if="signatures?.data?.length">
      <div
        v-for="signature in signatures?.data"
        :key="signature.name"
        class="hover:bg-surface-gray-1 -mx-2 flex cursor-pointer items-center justify-between rounded-4 px-3 py-1 max-sm:-mx-4 max-sm:px-4 max-sm:py-2"
        @click="editSignature(signature)"
      >
        <span class="text-base">{{ signature.signature_name }}</span>
        <!-- .stop lives on the wrapper: AdaptiveDropdown's mobile trigger opens
				     via the click bubbling to its own span, so stopping on the Button
				     itself would keep the sheet from opening. -->
        <div class="flex max-sm:-mr-1.5" @click.stop>
          <AdaptiveDropdown
            :options="signatureOptions(signature)"
            :title="signature.signature_name"
          >
            <Button variant="ghost">
              <template #icon>
                <Ellipsis class="text-ink-gray-5 h-4 w-4" />
              </template>
            </Button>
          </AdaptiveDropdown>
        </div>
      </div>
    </div>

    <div v-else class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
      <p class="text-base-medium">{{ __('No signatures yet') }}</p>

      <p>
        {{ __('Signatures let you automatically add personalized content to your messages.') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, FormControl } from 'frappe-ui'
import { Edit2, Ellipsis, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import { translate as __ } from '@/platform/translation'

type Signature = OutputOf<typeof api.mail.signatures.list>[number]

const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))

const signatures = useQuery(api.mail.signatures.list)
const createSignature = useMutation(api.mail.signatures.create)
const updateSignature = useMutation(api.mail.signatures.update)
const deleteSignature = useMutation(api.mail.signatures.delete)

// The signature being written. Without a name it is a new one; unset, the list shows
const draft = ref<{ name?: string; signature_name: string; html_body: string }>()
const formTitle = computed(() => {
  if (draft.value?.name) {
    return __('Edit signature')
  }

  return __('New signature')
})
const isSaving = computed(() => createSignature.isPending || updateSignature.isPending)
const isSaveBlocked = computed(() => !draft.value?.signature_name || !draft.value.html_body)

function addSignature() {
  draft.value = { signature_name: '', html_body: '' }
}

function editSignature(signature: Signature) {
  draft.value = {
    name: signature.name,
    signature_name: signature.signature_name,
    html_body: signature.html_body ?? '',
  }
}

function showList() {
  draft.value = undefined
}

async function save() {
  if (!draft.value) {
    return
  }

  const { name, ...content } = draft.value
  if (name) {
    await updateSignature.run({ name, ...content })
    raiseToast(__('Signature updated'))
  } else {
    await createSignature.run(content)
    raiseToast(__('Signature created'))
  }

  showList()
}

function signatureOptions(signature: Signature) {
  return [
    {
      label: __('Edit'),
      icon: Edit2,
      onClick: () => editSignature(signature),
    },
    {
      label: __('Delete'),
      icon: Trash2,
      theme: 'red' as const,
      onClick: async () => {
        await deleteSignature.run({ name: signature.name })
      },
    },
  ]
}
</script>
