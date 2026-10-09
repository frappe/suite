<template>
  <!-- While the request runs the dialog cannot be dismissed or edited: a second click or an
	     early close would leave a half-created account behind. -->
  <Dialog
    v-model:open="show"
    :dismissible="!addMember.isPending"
    :show-close-button="!addMember.isPending"
    v-bind="{
      title: __('Add user'),
      actions: temporaryPassword
        ? []
        : [
            {
              label: __(accountRequest.send_invite ? 'Send invitation' : 'Add user'),
              variant: 'solid' as const,
              loading: addMember.isPending,
              onClick: addMemberSubmit,
            },
          ],
    }"
  >
    <template #default>
      <div v-if="temporaryPassword" class="space-y-4">
        <p class="text-base text-ink-gray-7">
          {{
            __(
              'Share this temporary password privately with the new user. It is shown once, expires after seven days, and cannot be used by Mail clients. The user must change it before normal access.',
            )
          }}
        </p>
        <FormControl :value="temporaryPassword" readonly :label="__('Temporary password')" />
        <Button :label="__('I have saved it securely')" @click="show = false" />
      </div>
      <div v-else class="relative">
        <div
          v-if="addMember.isPending"
          class="bg-surface-white/60 absolute inset-0 z-10 flex items-center justify-center rounded-4"
        >
          <LoadingIndicator class="text-ink-gray-6 h-6 w-6" />
        </div>
        <div
          class="space-y-4"
          :class="{ 'pointer-events-none select-none': addMember.isPending }"
          :aria-busy="addMember.isPending"
        >
          <div class="space-y-3">
            <div v-for="(email, index) in emails" :key="index" class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label class="text-ink-gray-5 block text-xs">
                  {{ index === 0 ? __('Primary Email') : __('Alias') }}
                </label>
                <Button
                  v-if="index > 0"
                  variant="ghost"
                  theme="red"
                  size="sm"
                  :label="__('Remove')"
                  @click="emails.splice(index, 1)"
                />
              </div>
              <div class="flex items-center justify-between">
                <FormControl v-model="email.username" placeholder="johndoe" class="w-full" />
                <FeatherIcon class="text-ink-gray-3 mx-2.5 h-4 w-4" name="at-sign" />
                <FormControl
                  v-model="email.domain"
                  type="combobox"
                  placeholder="yourdomain.com"
                  class="w-full"
                  :options="domains.data"
                  :open-on-click="true"
                />
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              :label="__('Add another email')"
              @click="emails.push({ username: '', domain: emails[0]?.domain || '' })"
            >
              <template #prefix>
                <FeatherIcon name="plus" class="h-4 w-4" />
              </template>
            </Button>
          </div>
          <FormControl
            v-model="accountRequest.role"
            type="select"
            :label="__('Role')"
            :options="ROLE_OPTIONS"
          />
          <FormControl
            v-if="accountRequest.send_invite"
            v-model="accountRequest.backup_email"
            type="email"
            :label="__('Existing contact email')"
            placeholder="johndoe@personal.com"
            :description="__('Password resets and the invitation email are sent to this address.')"
          />
          <div class="space-y-1.5">
            <label class="text-ink-gray-5 block text-xs">{{ __('Groups') }}</label>
            <MultiSelect v-model="groupIds" :options="groupOptions" />
          </div>
          <div class="space-y-1.5">
            <label class="text-ink-gray-5 block text-xs">{{ __('Mailing Lists') }}</label>
            <MultiSelect v-model="mailingListIds" :options="mailingListOptions" />
          </div>
          <hr />

          <Switch
            v-model="accountRequest.disable_receiving"
            :label="__('Disable Receiving')"
            :description="
              __(
                'The account can send emails but cannot receive them. Mail addressed to it bounces back to the sender.',
              )
            "
            class="hover:!bg-surface-base !cursor-default !p-0"
          />
          <Switch
            v-model="accountRequest.send_invite"
            :label="__('Send Invite')"
            class="hover:!bg-surface-base !cursor-default !p-0"
          />
          <FormControl
            v-if="accountRequest.send_invite"
            v-model="accountRequest.expires_at"
            :label="__('Expires At')"
            type="datetime-local"
            :description="__('The invitation link stops working after this time.')"
          />
          <template v-else>
            <FormControl
              v-model="accountRequest.first_name"
              :label="__('First Name')"
              placeholder="John"
            />
            <FormControl
              v-model="accountRequest.last_name"
              :label="__('Last Name')"
              placeholder="Doe"
            />
            <p class="text-sm text-ink-gray-6">
              {{
                __(
                  'Suite generates a temporary password and shows it once after setup. No contact email is required.',
                )
              }}
            </p>
            <!-- Only set here when the account is created right away; an invited user picks
					their own on the setup form. -->
            <div class="space-y-1.5">
              <label class="text-ink-gray-5 block text-xs">{{ __('Locale') }}</label>
              <Combobox
                v-model="accountRequest.locale"
                :options="localeOptions"
                :placeholder="__('Select a locale')"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-ink-gray-5 block text-xs">{{ __('Time Zone') }}</label>
              <Combobox
                v-model="accountRequest.time_zone"
                :options="timeZoneOptions"
                :placeholder="__('Select a time zone')"
              />
            </div>
          </template>
          <ErrorMessage
            :message="
              setupError ||
              domainsError ||
              (addMember.error &&
                (addMember.error?.messages?.[0] ||
                  addMember.error?.message ||
                  __('Request failed.')))
            "
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import {
  Button,
  Combobox,
  Dialog,
  ErrorMessage,
  FormControl,
  LoadingIndicator,
  MultiSelect,
  Switch,
} from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { useAccountOptions } from '@/apps/mail/composables/useAccountOptions'
import { useEnabledDomains } from '@/apps/mail/composables/useEnabledDomains'
import { raiseToast } from '@/apps/mail/utils'
import { fromLocalInput, toLocalInput, utcFromNow } from '@/apps/mail/utils/datetime'

const show = defineModel<boolean>()
const temporaryPassword = ref('')
const setupError = ref('')
const { domains, domainsError } = useEnabledDomains(show)
const ROLE_OPTIONS = [
  {
    label: __('Normal User'),
    value: 'user',
  },
  {
    label: __('Admin'),
    value: 'admin',
  },
]
const defaultAccountRequest = {
  role: 'user',
  send_invite: true,
  expires_at: '',
  backup_email: '',
  // Blank hands the choice to the server, which falls back to the configured default.
  quota_gb: '',
  disable_receiving: false,
  first_name: '',
  last_name: '',
  locale: '',
  time_zone: '',
}
const accountRequest = reactive({
  ...defaultAccountRequest,
})
const emails = ref<
  {
    username: string
    domain: string
  }[]
>([
  {
    username: '',
    domain: '',
  },
])
const groupIds = ref<string[]>([])
const mailingListIds = ref<string[]>([])
const emit = defineEmits(['reload'])
type Directory = {
  id: string
  name: string
  email?: string
}

// The account joins these once it exists: immediately when the invite is skipped, otherwise when the
// invited user verifies and their account is created. Both are read live from Stalwart, so they are
// fetched when the dialog opens rather than on every visit to the accounts list.
const groups = useQuery(api.mail.admin.groups.list, () =>
  show.value
    ? {
        page_length: 500,
      }
    : false,
)
const mailingLists = useQuery(api.mail.admin.mailingLists.list, () =>
  show.value
    ? {
        page_length: 500,
      }
    : false,
)
const toOptions = (rows: Directory[]) =>
  rows.map((r) => ({
    label: r.email || r.name,
    value: r.id,
  }))
const groupOptions = computed(() => toOptions(groups.data?.items || []))
const mailingListOptions = computed(() => toOptions(mailingLists.data?.items || []))
const { localeOptions, timeZoneOptions } = useAccountOptions()
watch(
  () => accountRequest.send_invite,
  () => addMember.reset(),
)
watch(show, () => {
  temporaryPassword.value = ''
  setupError.value = ''
  addMember.reset()
  if (show.value) {
    // Shown and typed in the user's zone (converted to UTC on submit), and seeded here rather
    // than in the default shape so a dialog opened later gets a fresh expiry.
    Object.assign(accountRequest, defaultAccountRequest, {
      expires_at: toLocalInput(utcFromNow(7, 'day')),
    })
    emails.value = [
      {
        username: '',
        domain: '',
      },
    ]
    groupIds.value = []
    mailingListIds.value = []
    groups.refetch().catch(() => {})
    mailingLists.refetch().catch(() => {})
    addMember.reset()
  }
})
const addMember = useMutation(api.mail.admin.members.create)
async function addMemberSubmit() {
  const [primary, ...rest] = emails.value
  const aliases = rest.filter((e) => e.username && e.domain).map((e) => `${e.username}@${e.domain}`)
  const input: InputOf<typeof api.mail.admin.members.create> = {
    ...accountRequest,
    username: primary?.username || '',
    domain: primary?.domain || '',
    aliases,
    groups: groupIds.value,
    mailing_lists: mailingListIds.value,
    expires_at: fromLocalInput(accountRequest.expires_at),
    quota_gb: 0,
    // Blank means "server default" for both, which the API spells as null.
    locale: accountRequest.locale || null,
    time_zone: accountRequest.time_zone || null,
    is_admin: accountRequest.role === 'admin',
  }
  const result = await addMember.run(input)
  if (!result.success) {
    setupError.value = result.error || __('Account setup failed. Retry to resume this creation.')
    return
  }
  temporaryPassword.value = result.temporary_password || ''
  raiseToast(accountRequest.send_invite ? __('Invitation sent.') : __('Account added.'))
  emit('reload')
  if (!temporaryPassword.value) show.value = false
}
</script>
