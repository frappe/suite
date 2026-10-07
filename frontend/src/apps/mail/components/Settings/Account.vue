<template>
  <AppSettingsHeader :title="__('Account')">
    <template v-if="draft" #actions>
      <Button
        :label="__('Save')"
        variant="solid"
        :size="isMobile ? 'md' : 'sm'"
        :disabled="loading || !isDirty"
        :loading="saving"
        @click="save"
      />
    </template>
  </AppSettingsHeader>
  <AppSettingsBody>
    <template v-if="draft">
      <div class="flex flex-col gap-5">
        <h2 class="text-base-semibold text-ink-gray-8">{{ __('Outgoing') }}</h2>
        <SettingsRow
          class="!py-0"
          :title="__('Default Outgoing Email')"
          :description="__('The address selected automatically when composing a message.')"
        >
          <Combobox
            v-model="draft.default_outgoing_email"
            trigger="button"
            align="end"
            :options="(identities.data ?? []).map((i: Identity) => i.email)"
          />
        </SettingsRow>
        <SettingsRow
          class="!py-0"
          :title="__('Create Contacts After Sending Email')"
          :description="
            __('Automatically creates contacts for new recipients after an email is sent.')
          "
        >
          <Switch v-model="createContactsAfterEmailSubmit" />
        </SettingsRow>
        <SettingsRow
          class="!py-0"
          :title="__('Delete Email After Sending')"
          :description="__('Automatically deletes the email from your mailbox after it is sent.')"
        >
          <Switch v-model="destroyEmailAfterSubmit" />
        </SettingsRow>
        <SettingsRow
          class="!py-0"
          :title="__('Delete Newsletter After Sending')"
          :description="__('Automatically deletes the newsletter after it is sent.')"
        >
          <Switch v-model="destroyNewsletterAfterSubmit" />
        </SettingsRow>
        <SettingsRow
          class="!py-0"
          :title="__('Keep Forwarded Email In Thread')"
          :description="__('Keep forwarded emails in the original thread.')"
        >
          <Switch v-model="keepForwardedEmailInThread" />
        </SettingsRow>

        <h2 class="text-base-semibold text-ink-gray-8">{{ __('Incoming') }}</h2>
        <SettingsRow
          class="!py-0"
          :title="__('Screen New Senders')"
          :description="__('Send emails from new senders to the Screener until accepted.')"
        >
          <Switch v-model="enableScreening" />
        </SettingsRow>
        <SettingsRow
          class="!py-0"
          :title="__('Block Remote Images')"
          :description="__(`Don't load remote images from untrusted sources by default.`)"
        >
          <Switch v-model="blockRemoteImages" />
        </SettingsRow>
        <SettingsRow
          class="!py-0"
          :title="__('When Marking as Junk')"
          :description="__('Choose how to handle future messages from this sender.')"
        >
          <Select v-model="draft.on_mark_as_junk" :options="ON_MARK_AS_JUNK_OPTIONS" />
        </SettingsRow>

        <!-- Read-only, so it sits after the settings rather than ahead of them; the
		     sidebar shows this meter only once the account is nearly full. -->
        <h2 class="text-base-semibold text-ink-gray-8">{{ __('Storage') }}</h2>
        <StorageMeter :used-percentage :label :limited="isLimited" />

        <ErrorMessage :message="savePreferences.error?.message" />

      </div>
    </template>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Button, Combobox, ErrorMessage, Select, SettingsRow, Switch } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import { useQuota } from '@/apps/mail/composables/useQuota'
import { userStore } from '@/apps/mail/stores/user'
import type { Identity } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import StorageMeter from '@/components/StorageMeter.vue'

const { isMobile } = useScreenSize()
const { isLimited, usedPercentage, label } = useQuota()
// Read store.accountId live in makeParams; destructuring would snapshot the
// unwrapped value and miss account switches while this component stays mounted.
const store = userStore()
const { identities } = store

// Outgoing settings live on the active account's JMAP Account. Recovery (backup_email) and the
// JMAP connection credentials moved to the dedicated Credentials tab (CredentialsSettings.vue).
const preferences = useQuery(api.mail.settings.account, () =>
  store.accountId
    ? {
        account: store.accountId,
      }
    : false,
)
const draft = ref<OutputOf<typeof api.mail.settings.account>>()
watch(
  () => preferences.data,
  (data) => {
    draft.value = data
      ? {
          ...data,
        }
      : undefined
  },
  {
    immediate: true,
  },
)
const savePreferences = useMutation(api.mail.settings.updateAccount)
const createContactsAfterEmailSubmit = computed({
  get: () => !!draft.value?.create_contacts_after_email_submit,
  set: (val: boolean) => (draft.value!.create_contacts_after_email_submit = val ? 1 : 0),
})
const destroyEmailAfterSubmit = computed({
  get: () => !!draft.value?.destroy_email_after_submit,
  set: (val: boolean) => (draft.value!.destroy_email_after_submit = val ? 1 : 0),
})
const destroyNewsletterAfterSubmit = computed({
  get: () => !!draft.value?.destroy_newsletter_after_submit,
  set: (val: boolean) => (draft.value!.destroy_newsletter_after_submit = val ? 1 : 0),
})
const keepForwardedEmailInThread = computed({
  get: () => !!draft.value?.keep_forwarded_email_in_thread,
  set: (val: boolean) => (draft.value!.keep_forwarded_email_in_thread = val ? 1 : 0),
})
const enableScreening = computed({
  get: () => !!draft.value?.enable_screening,
  set: (val: boolean) => (draft.value!.enable_screening = val ? 1 : 0),
})
const blockRemoteImages = computed({
  get: () => !!draft.value?.block_remote_images,
  set: (val: boolean) => (draft.value!.block_remote_images = val ? 1 : 0),
})
const ON_MARK_AS_JUNK_OPTIONS = [
  {
    label: __('Move future emails to Junk'),
    value: "Junk Sender's Mail",
  },
  {
    label: __('Ask whether to block the sender'),
    value: 'Ask to Block Sender',
  },
]
const accountDirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(preferences.data),
)
const isDirty = computed(() => accountDirty.value)
const loading = computed(() => preferences.isFetching)
const saving = computed(() => savePreferences.isPending)
const save = async () => {
  if (!draft.value) return
  await savePreferences.run({
    account: store.accountId,
    changes: {
      ...draft.value,
    },
  })
  raiseToast(__('Account updated.'))
}
</script>
