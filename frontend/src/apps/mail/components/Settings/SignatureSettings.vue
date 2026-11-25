<template>
  <!-- One signature, written in place of the list on a computer, where the arrow goes back to it;
       on a phone, in a sheet over the list, as the other forms that open from a settings page are. -->
  <component
    :is="isMobile ? AdaptiveDialog : 'div'"
    v-if="draft"
    v-bind="isMobile ? draftSheet : {}"
  >
    <div class="flex flex-col gap-4">
      <SettingsDialogBack
        v-if="!isMobile"
        :title="formTitle"
        :label="__('Back to signatures')"
        @back="showList"
      />
      <FormControl
        v-model="draft.signature_name"
        :label="__('Name')"
        :placeholder="__('Work signature')"
        variant="outline"
      />
      <div class="space-y-1.5">
        <FormLabel :label="__('Signature')" />
        <MailRichTextField
          v-model="draft.html_body"
          :placeholder="__('Write your signature here')"
        />
      </div>
      <ErrorMessage :message="saveError" />
      <SettingsDialogActions v-if="!isMobile">
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
  </component>
  <!-- On a phone the list stays under a signature's sheet -->
  <div v-if="isMobile || !draft" class="flex flex-col gap-3">
    <SettingsDialogActions bar>
      <Button
        icon-left="lucide-plus"
        :label="__('New')"
        :aria-label="__('New signature')"
        :variant="isMobile ? 'ghost' : 'subtle'"
        :size="buttonSize"
        @click="addSignature"
      />
    </SettingsDialogActions>
    <div v-if="signatures?.data?.length">
      <div
        v-for="signature in signatures?.data"
        :key="signature.name"
        class="hover:bg-surface-gray-1 -mx-2 flex cursor-pointer items-center justify-between rounded-4 px-3 py-1 max-sm:-mx-4 max-sm:px-4 max-sm:py-1.5"
        @click="editSignature(signature)"
      >
        <span class="text-ink-gray-8 truncate text-base">{{ signature.signature_name }}</span>
        <!-- .stop lives on the wrapper: AdaptiveDropdown's trigger opens via the click bubbling to
             its own span, so stopping on the Button itself would keep its menu from opening. -->
        <div class="flex max-sm:-mr-1.5" @click.stop>
          <AdaptiveDropdown
            :options="signatureOptions(signature)"
            :title="signature.signature_name"
          >
            <Button variant="ghost" :aria-label="__('{0} options', [signature.signature_name])">
              <template #icon>
                <Ellipsis class="text-ink-gray-5 h-4 w-4" />
              </template>
            </Button>
          </AdaptiveDropdown>
        </div>
      </div>
    </div>

    <SettingsEmptyList
      v-else
      :title="__('No signatures yet')"
      :description="
        __('Signatures let you automatically add personalized content to your messages.')
      "
    />
  </div>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl, FormLabel } from 'frappe-ui'
import { Edit2, Ellipsis, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { failureLine } from '@/platform/feedback'
import AdaptiveDialog from '@/platform/feedback/AdaptiveDialog.vue'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import SettingsDialogBack from '@/platform/settings/SettingsDialogBack.vue'
import SettingsEmptyList from '@/platform/settings/SettingsEmptyList.vue'
import { translate as __ } from '@/platform/translation'

type Signature = OutputOf<typeof api.mail.signatures.list>[number]

const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))

const signatures = useQuery(api.mail.signatures.list)
// A refused save is said on the signature that was saved, where the eyes are, so no toast says it
const createSignature = useMutation(api.mail.signatures.create, { silent: true })
const updateSignature = useMutation(api.mail.signatures.update, { silent: true })
const saveError = computed(() => failureLine(createSignature.error ?? updateSignature.error))
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
  isSheetOpen.value = true
}

function editSignature(signature: Signature) {
  draft.value = {
    name: signature.name,
    signature_name: signature.signature_name,
    html_body: signature.html_body ?? '',
  }
  isSheetOpen.value = true
}

// A phone's sheet slides away before its form goes: the form is cleared once it is out of sight
const isSheetOpen = ref(false)
function closeForm() {
  if (isMobile.value) {
    isSheetOpen.value = false
  } else {
    showList()
  }
}

// A phone's sheet: Save under the fields, the width of the sheet
const draftSheet = computed(() => ({
  open: isSheetOpen.value,
  title: formTitle.value,
  'onUpdate:open': (open: boolean) => !open && closeForm(),
  onAfterLeave: showList,
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: isSaveBlocked.value,
      loading: isSaving.value,
      onClick: () => save(),
    },
  ],
}))

function showList() {
  draft.value = undefined
  // What was refused is left behind with its signature, so the next one opens without it
  createSignature.reset()
  updateSignature.reset()
}

async function save() {
  const form = draft.value
  if (!form) {
    return
  }

  const { name, ...content } = form
  if (name) {
    await updateSignature.run({ name, ...content })
    raiseToast(__('Signature updated'))
  } else {
    await createSignature.run(content)
    raiseToast(__('Signature created'))
  }

  // A slow save can end after another signature was opened, and that one stays
  if (draft.value === form) {
    closeForm()
  }
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
