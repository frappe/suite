<template>
  <DashboardLayout
    area="admin"
    :breadcrumbs="[{ label: __('Users') }]"
    :loading="users.status === 'pending'"
  >
    <template #actions>
      <Button
        v-if="storage.data?.cloud"
        variant="solid"
        :label="__('Manage invitations')"
        route="/admin/mail/invitations"
      />
      <Button v-else variant="solid" :label="__('Invite users')" @click="inviting = true" />
    </template>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <TextInput
        v-model="search"
        type="text"
        :placeholder="__('Search users')"
        class="w-full sm:w-64"
      >
        <template #prefix>
          <span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
        </template>
      </TextInput>
      <p class="text-sm text-ink-gray-5">{{ __('{0} users', [filtered.length]) }}</p>
    </div>

    <ErrorMessage v-if="users.error" :message="users.error.message" />
    <ErrorMessage :message="change.error?.message || replacePassword.error?.message" />

    <List
      class="-mx-3 list-row-px-3"
      :columns="['minmax(0,1fr)', '8.5rem', '10rem', '3rem']"
      :row-height="56"
    >
      <ListHeader>
        <ListHeaderCell>{{ __('User') }}</ListHeaderCell>
        <ListHeaderCell>{{ __('Role') }}</ListHeaderCell>
        <ListHeaderCell>{{ __('Status') }}</ListHeaderCell>
        <ListHeaderCell
          ><span class="sr-only">{{ __('Actions') }}</span></ListHeaderCell
        >
      </ListHeader>
      <ListRow v-for="user in filtered" :key="user.name" :value="user.name">
        <ListCell>
          <Avatar :label="user.full_name" :image="user.user_image ?? undefined" size="sm" />
          <div class="ml-3 min-w-0">
            <p class="truncate text-base text-ink-gray-8">{{ user.full_name }}</p>
            <p class="truncate text-p-sm text-ink-gray-5">{{ user.account || user.email }}</p>
          </div>
        </ListCell>
        <ListCell>
          <Badge :label="roleLabel(user)" theme="gray" variant="subtle" />
        </ListCell>
        <ListCell>
          <div class="min-w-0">
            <Badge
              :label="user.enabled ? __('Active') : __('Disabled')"
              :theme="user.enabled ? 'green' : 'gray'"
              variant="subtle"
            />
            <p
              v-if="setupNote(user)"
              class="mt-1.5 truncate text-p-sm text-ink-amber-6"
              :title="setupNote(user)"
            >
              {{ setupNote(user) }}
            </p>
          </div>
        </ListCell>
        <ListCell class="justify-end">
          <Dropdown :options="userActions(user)" align="end">
            <Button
              variant="ghost"
              icon="lucide-ellipsis"
              :label="__('Actions for {0}', [user.full_name])"
            />
          </Dropdown>
        </ListCell>
      </ListRow>
    </List>

    <div
      v-if="!filtered.length && !users.error"
      class="flex flex-col items-center gap-1 py-16 text-center"
    >
      <span
        :class="search ? 'lucide-search-x' : 'lucide-users'"
        class="size-6 text-ink-gray-4"
        aria-hidden="true"
      />
      <p class="text-base font-medium text-ink-gray-7">
        {{ search ? __('No users found') : __('No users yet') }}
      </p>
      <p class="text-p-sm text-ink-gray-5">
        {{
          search
            ? __('Try a different name or email address.')
            : __('Invite someone to give them access to this site.')
        }}
      </p>
    </div>

    <Dialog v-model:open="inviting" :title="__('Invite users')" :dismissible="!invite.isPending">
      <template #default>
        <div class="space-y-4">
          <FormControl
            v-model="emails"
            type="textarea"
            :label="__('Email addresses')"
            :placeholder="__('one address per line')"
          />
          <ErrorMessage :message="invite.error?.message" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button :label="__('Cancel')" :disabled="invite.isPending" @click="inviting = false" />
          <Button
            variant="solid"
            :label="__('Send invitations')"
            :loading="invite.isPending"
            :disabled="!emails.trim()"
            @click="sendInvites"
          />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:open="profileOpen"
      :title="__('Edit user profile')"
      :dismissible="!change.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <FormControl v-model="profileName" :label="__('Display name')" />
          <ErrorMessage :message="change.error?.message" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button :label="__('Cancel')" :disabled="change.isPending" @click="profileOpen = false" />
          <Button
            variant="solid"
            :label="__('Save')"
            :loading="change.isPending"
            :disabled="!profileName.trim()"
            @click="saveProfile"
          />
        </div>
      </template>
    </Dialog>

    <Dialog v-model:open="credentialOpen" :title="__('One-time temporary password')">
      <template #default>
        <div class="space-y-4">
          <p class="text-p-base text-ink-gray-7">
            {{
              __(
                'Share this password privately. It is shown once, expires after seven days, and cannot be used by Mail clients. The user must change it before normal access.',
              )
            }}
          </p>
          <FormControl v-model="credential" readonly :label="__('Temporary password')" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <Button variant="solid" :label="__('Done')" @click="credentialOpen = false" />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:open="recreationOpen"
      :title="__('Recreate empty Mail account')"
      :dismissible="!recreateMail.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <p class="text-p-base text-ink-gray-7">
            {{
              __(
                'Deleted messages, aliases and memberships do not return. Choose an available address; one reassigned elsewhere will never be reclaimed. The Suite user stays disabled.',
              )
            }}
          </p>
          <FormControl
            v-model="recreatedAddress"
            type="email"
            :label="__('Available business address')"
          />
          <ErrorMessage :message="recreationError || recreateMail.error?.message" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button
            :label="__('Cancel')"
            :disabled="recreateMail.isPending"
            @click="recreationOpen = false"
          />
          <Button
            variant="solid"
            :label="__('Recreate account')"
            :loading="recreateMail.isPending"
            :disabled="!recreatedAddress.trim()"
            @click="recreateAccount"
          />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:open="transferOpen"
      :title="__('Transfer retained Drive content')"
      :dismissible="!transfer.isPending && !previewPending"
    >
      <template #default>
        <div class="space-y-4">
          <p class="text-p-base text-ink-gray-7">
            {{
              __(
                'Choose an existing named folder in another Personal or Shared Root. Retained versions and trash move too; trash stays deleted and existing links and explicit grants are preserved.',
              )
            }}
          </p>
          <FormControl
            v-model="destinationFolder"
            :label="__('Destination folder')"
            :placeholder="__('Paste a folder link or paste its ID')"
          />
          <div class="flex justify-end">
            <Button
              :label="__('Preview transfer')"
              :loading="previewPending"
              :disabled="!destinationFolder.trim() || transfer.isPending"
              @click="previewTransfer"
            />
          </div>
          <ErrorMessage :message="previewError || transfer.error?.message" />
          <template v-if="transferPreview">
            <p class="text-base text-ink-gray-8">
              {{
                __('{0} top-level items · {1}', [
                  transferPreview.item_count,
                  bytes(transferPreview.bytes),
                ])
              }}
            </p>
            <p class="text-p-sm text-ink-gray-5">
              {{
                __(
                  'Destination inherited access applies. The server checked destination storage capacity; site-neutral moves need no additional site headroom.',
                )
              }}
            </p>
            <ul class="space-y-1">
              <li
                v-for="grant in transferPreview.inherited_grants"
                :key="grant.principal"
                class="text-p-sm text-ink-gray-6"
              >
                {{ grant.principal }} · {{ grant.role }}
              </li>
            </ul>
            <FormControl
              v-model="confirmTransferAccess"
              type="checkbox"
              :label="__('I confirm the destination access changes')"
            />
          </template>
          <template v-if="transferResults">
            <p class="text-base text-ink-gray-8">
              {{
                transferResults.complete
                  ? __('Transfer complete. The source Personal Root is empty.')
                  : __('{0} retained nodes remain. Preview again to retry only unfinished work.', [
                      transferResults.remaining,
                    ])
              }}
            </p>
            <ul class="space-y-1">
              <li
                v-for="result in transferResults.results"
                :key="result.node"
                class="text-p-sm"
                :class="result.success ? 'text-ink-green-6' : 'text-ink-red-6'"
              >
                {{ result.node }}: {{ result.success ? __('Moved') : result.error }}
              </li>
            </ul>
          </template>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button
            v-if="transferResults"
            :label="__('Close')"
            :disabled="transfer.isPending"
            @click="transferOpen = false"
          />
          <Button
            v-if="transferResults"
            variant="solid"
            :label="__('Preview again')"
            @click="resetTransfer"
          />
          <Button
            v-else-if="transferPreview"
            variant="solid"
            :label="__('Transfer next batch')"
            :disabled="!confirmTransferAccess || !transferPreview.item_count"
            :loading="transfer.isPending"
            @click="runTransfer"
          />
        </div>
      </template>
    </Dialog>
  </DashboardLayout>
</template>

<script setup lang="ts">
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  dialog,
  Dropdown,
  ErrorMessage,
  FormControl,
  TextInput,
} from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import { computed, ref } from 'vue'

import { api, client, useMutation, useQuery, type OutputOf } from '@/api'
import { DashboardLayout } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

type User = OutputOf<typeof api.suite.users.list>[number]

const users = useQuery(api.suite.users.list)
const storage = useQuery(api.suite.storage.get)
const change = useMutation(api.suite.users.update)
const invite = useMutation(api.suite.invitations.create)
const search = ref('')

const filtered = computed(() =>
  (users.data ?? []).filter((user) =>
    `${user.full_name} ${user.email} ${user.account ?? ''}`
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
)

function roleLabel(user: User) {
  return user.is_admin ? __('Admin') : __('Normal User')
}

function setupNote(user: User): string | undefined {
  if (!storage.data?.cloud || user.setup_status === 'Active') return undefined
  return user.setup_status
}

// — invite —
const inviting = ref(false)
const emails = ref('')
async function sendInvites() {
  await invite.run({ emails: emails.value })
  inviting.value = false
}

// — profile —
const editingProfile = ref('')
const profileName = ref('')
const profileOpen = computed({
  get: () => !!editingProfile.value,
  set: (open) => {
    if (!open) editingProfile.value = ''
  },
})
async function saveProfile() {
  await change.run({ user: editingProfile.value, full_name: profileName.value })
  editingProfile.value = ''
}

// — temporary credentials —
const credential = ref('')
const replacePassword = useMutation(api.suite.users.replaceTemporaryPassword)
const credentialOpen = computed({
  get: () => !!credential.value,
  set: (open) => {
    if (!open) {
      credential.value = ''
      replacePassword.reset()
      recreateMail.reset()
    }
  },
})
async function replaceCredential(user: string) {
  const result = await replacePassword.run({ user })
  credential.value = result.temporary_password
}

// — Mail account recreation —
const recreatingUser = ref('')
const recreatedAddress = ref('')
const recreationError = ref('')
const recreateMail = useMutation(api.suite.users.recreateMail)
const recreationOpen = computed({
  get: () => !!recreatingUser.value,
  set: (open) => {
    if (!open) recreatingUser.value = ''
  },
})
async function recreateAccount() {
  const result = await recreateMail.run({
    user: recreatingUser.value,
    address: recreatedAddress.value,
  })
  recreationError.value = result.error || ''
  if (result.success) {
    credential.value = result.temporary_password || ''
    recreatingUser.value = ''
  }
}

// — retained Drive transfer —
const transferUser = ref('')
const destinationFolder = ref('')
const confirmTransferAccess = ref(false)
const transferPreview = ref<OutputOf<typeof api.suite.users.previewTransfer>>()
const transferResults = ref<OutputOf<typeof api.suite.users.transferDrive>>()
const transfer = useMutation(api.suite.users.transferDrive)
const previewPending = ref(false)
const previewError = ref('')
const transferOpen = computed({
  get: () => !!transferUser.value,
  set: (open) => {
    if (!open) transferUser.value = ''
  },
})

function bytes(value: number) {
  return __('{0} GB', [
    (value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
  ])
}

async function previewTransfer() {
  const destination =
    destinationFolder.value.trim().match(/\/drive\/f\/([^/?#]+)/)?.[1] ??
    destinationFolder.value.trim()
  confirmTransferAccess.value = false
  transferPreview.value = undefined
  previewError.value = ''
  previewPending.value = true
  try {
    transferPreview.value = await client.query(api.suite.users.previewTransfer, {
      user: transferUser.value,
      destination,
    })
  } catch (error) {
    previewError.value =
      error instanceof Error ? error.message : __('Unable to preview this transfer. Try again.')
  } finally {
    previewPending.value = false
  }
}

async function runTransfer() {
  if (!transferPreview.value) return
  transferResults.value = await transfer.run({
    user: transferUser.value,
    destination: transferPreview.value.destination,
    fingerprint: transferPreview.value.fingerprint,
    confirm_access: confirmTransferAccess.value,
  })
  transferPreview.value = undefined
}

function resetTransfer() {
  transferResults.value = undefined
  destinationFolder.value = ''
}

function userActions(user: User) {
  return [
    {
      label: __('Edit profile'),
      icon: 'lucide-pencil',
      onClick: () => {
        editingProfile.value = user.name
        profileName.value = user.full_name
      },
    },
    {
      label: user.is_admin ? __('Demote to Normal User') : __('Make Admin'),
      icon: 'lucide-shield',
      onClick: () => confirmUserChange(user, 'role'),
    },
    {
      label: user.enabled ? __('Disable user') : __('Reactivate user'),
      icon: user.enabled ? 'lucide-circle-off' : 'lucide-circle-play',
      theme: user.enabled ? ('red' as const) : ('gray' as const),
      onClick: () => confirmUserChange(user, 'enabled'),
    },
    {
      label: __('Mail settings'),
      icon: 'lucide-at-sign',
      condition: () => !!storage.data?.cloud && !!user.account,
      route: { name: 'mail-account', params: { accountId: user.name } },
    },
    {
      label: __('Replace temporary password'),
      icon: 'lucide-key-round',
      condition: () =>
        !!storage.data?.cloud &&
        !!user.account &&
        !['Setup failed', 'Deletion failed'].includes(user.setup_status),
      onClick: () =>
        dialog.confirm({
          title: __('Replace temporary password?'),
          message: __(
            'Existing credentials will be revoked. Mail stays locked until the user changes the new password.',
          ),
          confirmLabel: __('Replace password'),
          onConfirm: () => replaceCredential(user.name),
        }),
    },
    {
      label: __('Recreate Mail account'),
      icon: 'lucide-refresh-cw',
      condition: () =>
        !!storage.data?.cloud &&
        !user.enabled &&
        (!user.account || user.setup_status === 'Setup failed'),
      onClick: () => {
        recreatingUser.value = user.name
        recreatedAddress.value = ''
        recreationError.value = ''
        recreateMail.reset()
      },
    },
    {
      label: __('Transfer Drive'),
      icon: 'lucide-folder-output',
      condition: () => !user.enabled,
      onClick: () => {
        transferUser.value = user.name
        destinationFolder.value = ''
        confirmTransferAccess.value = false
        transferPreview.value = undefined
        transferResults.value = undefined
      },
    },
  ]
}

function confirmUserChange(user: User, kind: 'role' | 'enabled') {
  dialog.confirm({
    title:
      kind === 'role'
        ? user.is_admin
          ? __('Demote {0}?', [user.full_name])
          : __('Make {0} an Admin?', [user.full_name])
        : user.enabled
          ? __('Disable {0}?', [user.full_name])
          : __('Reactivate {0}?', [user.full_name]),
    message:
      kind === 'role'
        ? __('This changes access to business administration, not Drive sharing permissions.')
        : user.enabled
          ? __(
              'Sessions and outgoing access will be revoked. Incoming Mail and retained data are preserved.',
            )
          : __('Access returns after account and Drive readiness checks succeed.'),
    confirmLabel: __('Confirm'),
    onConfirm: async () => {
      await change.run({
        user: user.name,
        ...(kind === 'role' ? { is_admin: !user.is_admin } : { enabled: !user.enabled }),
      })
    },
  })
}
</script>
