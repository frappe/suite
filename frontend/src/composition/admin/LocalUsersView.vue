<template>
  <component
    :is="embedded ? 'div' : DashboardLayout"
    :class="embedded ? 'flex min-h-0 flex-1 flex-col gap-5' : undefined"
    area="admin"
    :breadcrumbs="[{ label: __('Users') }]"
  >
    <template v-if="!embedded" #actions>
      <Button
        v-if="storage.data?.cloud"
        variant="subtle"
        :label="__('Manage invitations')"
        route="/admin/users/invitations"
      />
      <Button v-else variant="subtle" :label="__('Invite users')" @click="inviting = true" />
    </template>

    <div v-if="selectedUsers.length" class="flex min-h-7 flex-wrap items-center gap-2">
      <span class="pr-1 text-base text-ink-gray-7 tabular-nums">{{
        __('{0} selected', [selectedUsers.length])
      }}</span>
      <Button
        icon-left="lucide-circle-play"
        :label="__('Reactivate')"
        @click="openLifecycle(true)"
      />
      <Button icon-left="lucide-circle-off" :label="__('Disable')" @click="openLifecycle(false)" />
      <Button class="ml-auto" variant="ghost" :label="__('Done')" @click="selectedUsers = []" />
    </div>
    <div v-else class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex w-full flex-wrap items-center gap-3 sm:w-auto">
        <slot name="lead" />
        <FormControl
          v-model="search"
          :placeholder="__('Search')"
          :aria-label="__('Search users')"
          class="w-full sm:w-80"
        >
          <template #prefix>
            <span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
          </template>
        </FormControl>
      </div>
      <div class="flex w-full flex-wrap items-center gap-3 sm:w-auto">
        <DashboardSkeletonText v-if="loading" class="flex-none text-sm" width="4rem" />
        <p v-else class="text-sm text-ink-gray-5">{{ __('{0} users', [filtered.length]) }}</p>
        <div class="min-w-0 flex-1 sm:w-40 sm:flex-none">
          <FormControl
            v-model="roleFilter"
            type="select"
            :aria-label="__('Role')"
            :options="[
              { label: __('All roles'), value: 'all' },
              { label: __('Admins'), value: 'admin' },
              { label: __('Members'), value: 'user' },
            ]"
          />
        </div>
        <div class="min-w-0 flex-1 sm:w-40 sm:flex-none">
          <FormControl
            v-model="statusFilter"
            type="select"
            :aria-label="__('Status')"
            :options="[
              { label: __('Any status'), value: 'all' },
              { label: __('Active'), value: 'enabled' },
              { label: __('Disabled'), value: 'disabled' },
            ]"
          />
        </div>
      </div>
    </div>

    <LoadFailed
      v-if="users.status === 'error'"
      :title="__('Could not load users')"
      :retry="() => users.refetch()"
    />

    <List
      v-if="users.status !== 'error'"
      v-model:selection="selectedUsers"
      selectable
      class="-mx-3 list-row-px-3"
      :columns="
        storage.data?.cloud
          ? {
              base: ['minmax(0,1fr)', '4.5rem', '2rem'],
              sm: ['minmax(0,1fr)', 'minmax(0,1.2fr)', '10rem', '10rem', '3rem'],
            }
          : {
              base: ['minmax(0,1fr)', '4.5rem', '2rem'],
              sm: ['minmax(0,1fr)', 'minmax(0,1.2fr)', '10rem', '3rem'],
            }
      "
      :row-height="56"
    >
      <ListHeader>
        <ListHeaderCell>{{ __('User') }}</ListHeaderCell>
        <ListHeaderCell class="max-sm:hidden">{{ __('Email') }}</ListHeaderCell>
        <ListHeaderCell>{{ __('Status') }}</ListHeaderCell>
        <ListHeaderCell v-if="storage.data?.cloud" class="max-sm:hidden">{{
          __('Storage')
        }}</ListHeaderCell>
        <ListHeaderCell
          ><span class="sr-only">{{ __('Actions') }}</span></ListHeaderCell
        >
      </ListHeader>
      <ListRows v-if="loading" v-slot="{ item }" :items="SKELETON_ROWS" row-key="name">
        <ListRow :value="item.name" class="pointer-events-none" aria-hidden="true">
          <ListCell>
            <Skeleton class="size-6 shrink-0 rounded-full" />
            <div class="ml-3 min-w-0 flex-1">
              <DashboardSkeletonText class="text-base" width="40%" />
              <DashboardSkeletonText class="text-p-sm sm:hidden" width="55%" />
            </div>
          </ListCell>
          <ListCell class="max-sm:hidden">
            <DashboardSkeletonText class="flex-1 text-base" width="60%" />
          </ListCell>
          <ListCell><Skeleton class="h-5 w-14 rounded-4" /></ListCell>
          <ListCell v-if="storage.data?.cloud" class="max-sm:hidden">
            <div class="flex-1 space-y-1.5">
              <DashboardSkeletonText class="text-p-sm" width="70%" />
              <div class="h-1 rounded-7 bg-surface-gray-2" />
            </div>
          </ListCell>
          <ListCell />
        </ListRow>
      </ListRows>
      <ListRows v-else v-slot="{ item: user }" :items="filtered" row-key="name">
        <ListRow :value="user.name">
          <ListCell>
            <Avatar :label="user.full_name" :image="user.user_image ?? undefined" size="sm" />
            <div class="ml-3 min-w-0">
              <div class="flex min-w-0 items-center gap-1.5">
                <p class="truncate text-base text-ink-gray-8">{{ user.full_name }}</p>
                <Tooltip v-if="user.is_admin" :text="__('Admin')">
                  <span
                    class="lucide-shield-check size-3.5 shrink-0 text-ink-gray-5"
                    role="img"
                    :aria-label="__('Admin')"
                  />
                </Tooltip>
              </div>
              <!-- On a phone the address sits under the name; on desktop it has its own column. -->
              <p class="truncate text-p-sm text-ink-gray-5 sm:hidden">
                {{ user.account || user.email }}
              </p>
            </div>
          </ListCell>
          <ListCell class="max-sm:hidden">
            <span class="truncate text-base text-ink-gray-6">{{ user.account || user.email }}</span>
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
                class="mt-1.5 flex min-w-0 items-center gap-1 text-p-sm text-ink-gray-6"
                :title="setupNote(user)"
              >
                <span
                  class="lucide-triangle-alert size-3 shrink-0 text-ink-amber-6"
                  aria-hidden="true"
                />
                <span class="truncate">{{ setupNote(user) }}</span>
              </p>
            </div>
          </ListCell>
          <ListCell v-if="storage.data?.cloud" class="max-sm:hidden">
            <StorageUsage v-if="userStorage(user)" :user="userStorage(user)!" />
          </ListCell>
          <ListCell class="justify-end" @click.stop>
            <Dropdown :options="userActions(user)" align="end">
              <Button
                variant="ghost"
                icon="lucide-ellipsis"
                :label="__('Actions for {0}', [user.account || user.email])"
              />
            </Dropdown>
          </ListCell>
        </ListRow>
      </ListRows>
    </List>
    <StorageLimitDialog v-if="storageEditing" v-model:open="storageEditing" :users="storageUsers" />

    <Dialog
      v-model:open="lifecycleOpen"
      :title="lifecycleEnabled ? __('Reactivate users') : __('Disable users')"
      :dismissible="!lifecyclePending"
    >
      <template #default>
        <div class="space-y-4">
          <p class="text-p-base text-ink-gray-7">
            {{
              lifecycleEnabled
                ? __('Access returns only after Mail account and Drive readiness checks succeed.')
                : __(
                    'Sessions and outgoing access will be revoked. Incoming Mail and retained data are preserved.',
                  )
            }}
          </p>
          <ul v-if="lifecycleResults.length" class="space-y-2">
            <li
              v-for="result in lifecycleResults"
              :key="result.user"
              class="text-p-sm"
              :class="result.success ? 'text-ink-green-6' : 'text-ink-red-6'"
            >
              {{ result.user }}:
              {{
                result.success
                  ? lifecycleEnabled
                    ? __('Reactivated')
                    : __('Disabled')
                  : result.error
              }}
            </li>
          </ul>
          <p v-else class="text-p-base text-ink-gray-7">
            {{ __('{0} users selected', [selectedUsers.length]) }}
          </p>
        </div>
      </template>
      <template #actions>
        <div class="flex justify-end gap-2">
          <Button
            :label="lifecycleResults.length ? __('Close') : __('Cancel')"
            :disabled="lifecyclePending"
            @click="lifecycleOpen = false"
          />
          <Button
            v-if="!lifecycleResults.length || lifecycleResults.some((result) => !result.success)"
            variant="solid"
            :theme="lifecycleEnabled ? 'gray' : 'red'"
            :label="
              lifecycleResults.length
                ? __('Retry failed users')
                : lifecycleEnabled
                  ? __('Reactivate users')
                  : __('Disable users')
            "
            :loading="lifecyclePending"
            @click="runLifecycle"
          />
        </div>
      </template>
    </Dialog>

    <div
      v-if="!loading && !filtered.length && users.status !== 'error'"
      class="flex flex-col items-center gap-1 py-16 text-center"
    >
      <span
        :class="hasFilters ? 'lucide-search-x' : 'lucide-users'"
        class="size-6 text-ink-gray-4"
        aria-hidden="true"
      />
      <p class="text-base font-medium text-ink-gray-7">
        {{ hasFilters ? __('No users found') : __('No users yet') }}
      </p>
      <p class="text-p-sm text-ink-gray-5">
        {{
          hasFilters
            ? __('Try a different search or change the filters.')
            : __('Invite someone to give them access to this site.')
        }}
      </p>
    </div>

    <Dialog v-model:open="inviting" :title="__('Invite users')" :dismissible="!inviteStep?.loading">
      <template #default>
        <InviteStep
          ref="inviteStep"
          :description="__('Separate multiple email addresses with commas or new lines')"
          autofocus
          @sent="onInvitesSent"
        />
      </template>
      <template #actions>
        <div class="flex justify-end gap-2">
          <Button :label="__('Cancel')" :disabled="inviteStep?.loading" @click="inviting = false" />
          <Button
            variant="solid"
            :label="__('Send invitations')"
            :loading="inviteStep?.loading"
            :disabled="!inviteStep?.canSubmit"
            @click="inviteStep?.submit()"
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
          <p class="text-p-base text-ink-gray-6">{{ editingProfile }}</p>
          <FormControl v-model="profileName" :label="__('Display name')" />
          <ErrorMessage :message="change.error?.message" />
        </div>
      </template>
      <template #actions>
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
      <template #actions>
        <div class="flex justify-end">
          <Button variant="solid" :label="__('Done')" @click="credentialOpen = false" />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:open="recreationOpen"
      :title="retryingSetup ? __('Retry Mail setup') : __('Recreate empty Mail account')"
      :dismissible="!recreateMail.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <p v-if="retryingSetup" class="text-p-base text-ink-gray-7">
            {{ __('Retry setup for the same user and business address. The user stays disabled.') }}
          </p>
          <p v-else class="text-p-base text-ink-gray-7">
            {{
              __(
                'Deleted messages, aliases and memberships do not return. Choose an available address; one reassigned elsewhere will never be reclaimed. The Suite user stays disabled.',
              )
            }}
          </p>
          <FormControl
            v-model="recreatedAddress"
            type="email"
            :readonly="retryingSetup && !!recreatedAddress"
            :label="__('Available business address')"
          />
          <ErrorMessage :message="recreationError || recreateMail.error?.message" />
        </div>
      </template>
      <template #actions>
        <div class="flex justify-end gap-2">
          <Button
            :label="__('Cancel')"
            :disabled="recreateMail.isPending"
            @click="recreationOpen = false"
          />
          <Button
            variant="solid"
            :label="retryingSetup ? __('Retry setup') : __('Recreate account')"
            :loading="recreateMail.isPending"
            :disabled="!recreatedAddress.trim()"
            @click="recreateAccount"
          />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:open="deletionOpen"
      :title="__('Delete Mail account')"
      :dismissible="!deleteMail.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <p class="text-p-base text-ink-gray-7">
            {{
              __(
                'Messages, aliases and memberships are permanently removed. The disabled Suite user and Drive content remain. Future messages may reach a new holder of this address.',
              )
            }}
          </p>
          <p class="text-base text-ink-gray-8">
            {{ deletingUser?.account || deletingUser?.email }}
          </p>
          <FormControl v-model="deletionConfirmation" :label="__('Type the account address')" />
          <ErrorMessage :message="deletionError || deleteMail.error?.message" />
        </div>
      </template>
      <template #actions>
        <div class="flex justify-end gap-2">
          <Button
            :label="__('Cancel')"
            :disabled="deleteMail.isPending"
            @click="deletionOpen = false"
          />
          <Button
            variant="solid"
            theme="red"
            :label="__('Delete Mail account')"
            :disabled="deletionConfirmation !== (deletingUser?.account || deletingUser?.email)"
            :loading="deleteMail.isPending"
            @click="deleteAccount"
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
          <template v-if="!transferResults">
            <Combobox
              v-model="transferTarget"
              :label="__('Transfer to')"
              :options="transferTargetOptions"
              :placeholder="__('Choose a person or a shared Drive')"
              :disabled="previewPending || transfer.isPending"
            />
            <p class="-mt-2 text-p-sm text-ink-gray-5">
              {{
                __(
                  'Everything goes into a new folder, “{0}”. Old versions and trashed items move too, and existing links and sharing keep working.',
                  [transferFolderTitle],
                )
              }}
            </p>
          </template>
          <div v-if="!transferPreview && !transferResults" class="flex justify-end">
            <Button
              :label="__('Preview transfer')"
              :loading="previewPending"
              :disabled="!transferTarget || transfer.isPending"
              @click="previewTransfer"
            />
          </div>
          <ErrorMessage :message="previewError || transfer.error?.message" />
          <template v-if="transferPreview">
            <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-p-base">
              <dt class="text-ink-gray-5">{{ __('What moves') }}</dt>
              <dd class="text-ink-gray-8">{{ itemsText }}</dd>
              <dt class="text-ink-gray-5">{{ __('Goes to') }}</dt>
              <dd class="text-ink-gray-8">{{ destinationText }}</dd>
              <dt class="text-ink-gray-5">{{ __('Storage there') }}</dt>
              <dd class="text-ink-gray-8">{{ storageText }}</dd>
              <template v-if="transferPreview.destination_capacity.reserved_bytes">
                <dt class="text-ink-gray-5">{{ __('In progress') }}</dt>
                <dd class="text-ink-gray-8">
                  {{ bytes(transferPreview.destination_capacity.reserved_bytes) }}
                </dd>
              </template>
              <template v-if="transferPreview.inherited_grants.length">
                <dt class="text-ink-gray-5">{{ __('Who gets access') }}</dt>
                <dd class="space-y-1 text-ink-gray-8">
                  <p v-for="grant in transferPreview.inherited_grants" :key="grant.principal">
                    {{ personName(grant.principal) }}
                    <span class="text-ink-gray-5">· {{ grantLabel(grant.role) }}</span>
                  </p>
                </dd>
              </template>
            </dl>
            <ErrorMessage
              v-if="transferPreview.destination_capacity.blocker"
              :message="blockerText"
            />
            <FormControl
              v-model="confirmTransferAccess"
              type="checkbox"
              :label="__('I understand these people will get access to the moved items')"
            />
          </template>
          <template v-if="transferResults">
            <p class="text-base text-ink-gray-8">
              {{
                transferResults.complete
                  ? __('Everything has moved to {0}.', [movedTo])
                  : transferResults.remaining === 1
                    ? __('1 item is left. Preview again to move it.')
                    : __('{0} items are left. Preview again to move them.', [
                        transferResults.remaining,
                      ])
              }}
            </p>
            <ul class="space-y-1">
              <li
                v-for="result in transferResults.results"
                :key="result.node"
                class="text-p-sm"
                :class="result.success ? 'text-ink-gray-7' : 'text-ink-red-6'"
              >
                {{ result.title }}:
                {{
                  result.success
                    ? __('Moved')
                    : result.error || __('Not moved. Preview again to retry.')
                }}
              </li>
            </ul>
          </template>
        </div>
      </template>
      <template #actions>
        <div class="flex justify-end gap-2">
          <Button
            :label="transferResults ? __('Close') : __('Cancel')"
            :disabled="transfer.isPending || previewPending"
            @click="transferOpen = false"
          />
          <Button
            v-if="transferResults && !transferResults.complete"
            variant="solid"
            :label="__('Preview again')"
            @click="resetTransfer"
          />
          <Button
            v-else-if="transferPreview"
            variant="solid"
            :label="
              transferPreview.item_count > TRANSFER_BATCH
                ? __('Transfer the first {0}', [TRANSFER_BATCH])
                : __('Transfer')
            "
            :disabled="
              !confirmTransferAccess ||
              !transferPreview.item_count ||
              !!transferPreview.destination_capacity.blocker
            "
            :loading="transfer.isPending"
            @click="runTransfer"
          />
        </div>
      </template>
    </Dialog>
  </component>
</template>

<script setup lang="ts">
import {
  Avatar,
  Badge,
  Button,
  Combobox,
  Dialog,
  dialog,
  ErrorMessage,
  FormControl,
  Skeleton,
  toast,
  Tooltip,
} from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { computed, defineAsyncComponent, ref, useTemplateRef, watch } from 'vue'

import { api, client, useMutation, useQuery, type OutputOf } from '@/api'
import { loadStorageLimitDialog } from '@/apps/mail'
import { DashboardLayout, DashboardSkeletonText } from '@/platform/dashboard'
import { Dropdown, failureText } from '@/platform/feedback'
import { LoadFailed } from '@/platform/load-failed'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import InviteStep from '@/shell/InviteStep.vue'

import { formatStorage } from './storageFormat'
import StorageUsage from './StorageUsage.vue'

type User = OutputOf<typeof api.suite.users.list>[number]

const props = withDefaults(
  defineProps<{ embedded?: boolean; status?: unknown; initialTransferUser?: string }>(),
  {
    embedded: false,
  },
)

const StorageLimitDialog = defineAsyncComponent(loadStorageLimitDialog)
const storageEditing = ref(false)
const storageUsers = ref<string[]>([])
const users = useQuery(api.suite.users.list)
const loading = computed(() => users.status === 'pending')
const SKELETON_ROWS = Array.from({ length: 8 }, (_, index) => ({ name: `skeleton-${index}` }))
const storage = useQuery(api.suite.storage.get)
// Every user change runs inside a dialog that shows its own error, so none of them also toasts.
const change = useMutation(api.suite.users.update, { silent: true })
// `lead` starts the filter row, e.g. the Users / Invitations switch.
defineSlots<{ lead?: () => unknown }>()
const search = ref('')
const roleFilter = ref('all')
const statusFilter = ref('all')
const hasFilters = computed(
  () => !!search.value || roleFilter.value !== 'all' || statusFilter.value !== 'all',
)
watch(
  () => props.status,
  (status) => {
    statusFilter.value = status === 'enabled' || status === 'disabled' ? status : 'all'
  },
  { immediate: true },
)
function userStorage(user: User) {
  return storage.data?.users.find((entry) => entry.name === user.name)
}
const selectedUsers = ref<string[]>([])
const lifecycleOpen = ref(false)
const lifecycleEnabled = ref(false)
const lifecyclePending = ref(false)
type LifecycleResult = { user: string; success: boolean; error: string | null }
const lifecycleResults = ref<LifecycleResult[]>([])
function openLifecycle(enabled: boolean) {
  lifecycleEnabled.value = enabled
  lifecycleResults.value = []
  lifecycleOpen.value = true
}
async function runLifecycle() {
  const targets = lifecycleResults.value.length
    ? lifecycleResults.value.filter((result) => !result.success).map((result) => result.user)
    : [...selectedUsers.value]
  const enabled = lifecycleEnabled.value
  lifecyclePending.value = true
  // One change per user, so one refusal (the last Admin, your own account) keeps the others.
  try {
    for (const user of targets) {
      let result: LifecycleResult
      try {
        await client.mutation(api.suite.users.update, { user, enabled }, { silent: true })
        result = { user, success: true, error: null }
        selectedUsers.value = selectedUsers.value.filter((name) => name !== user)
      } catch (error) {
        const reason =
          error instanceof Error ? failureText(error) : __('Could not change access. Try again.')
        result = { user, success: false, error: reason }
      }
      const previous = lifecycleResults.value.findIndex((entry) => entry.user === user)
      if (previous === -1) lifecycleResults.value.push(result)
      else lifecycleResults.value[previous] = result
    }
  } finally {
    lifecyclePending.value = false
  }
}

const filtered = computed(() =>
  (users.data ?? []).filter(
    (user) =>
      (roleFilter.value === 'all' || user.is_admin === (roleFilter.value === 'admin')) &&
      (statusFilter.value === 'all' || !!user.enabled === (statusFilter.value === 'enabled')) &&
      `${user.full_name} ${user.email} ${user.account ?? ''}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
)
watch(filtered, (users) => {
  const names = new Set(users.map((user) => user.name))
  selectedUsers.value = selectedUsers.value.filter((name) => names.has(name))
})

function setupNote(user: User): string | undefined {
  if (!storage.data?.cloud || user.setup_status === 'Active') return undefined
  return user.setup_status
}

// — invite —
const inviting = ref(false)
const inviteStep = useTemplateRef<InstanceType<typeof InviteStep>>('inviteStep')
function onInvitesSent(summary: string) {
  inviting.value = false
  toast.success(summary)
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
const replacePassword = useMutation(api.suite.users.replaceTemporaryPassword, { silent: true })
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
const retryingSetup = ref(false)
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
  recreationError.value = result.success
    ? ''
    : result.error || __('Mail setup failed. Retry with the same address.')
  if (result.success) {
    credential.value = result.temporary_password || ''
    recreatingUser.value = ''
  }
}

const deletingUser = ref<User>()
const deletionConfirmation = ref('')
const deletionError = ref('')
const deleteMail = useMutation(api.suite.users.deleteMail)
const deletionOpen = computed({
  get: () => !!deletingUser.value,
  set: (open) => {
    if (!open) deletingUser.value = undefined
  },
})
async function deleteAccount() {
  if (!deletingUser.value) return
  const result = await deleteMail.run({
    user: deletingUser.value.name,
    confirmation: deletionConfirmation.value,
  })
  deletionError.value = result.success
    ? ''
    : result.error || __('Deletion failed. Retry before reusing the address.')
  if (result.success) deletingUser.value = undefined
}

// — retained Drive transfer —
const transferUser = ref('')
/** A person's email, or `drive:` and a shared Drive's id. */
const transferTarget = ref<string | null>(null)
const sharedDrives = useQuery(api.suite.admin.sharedDrives.list, () =>
  transferUser.value ? {} : false,
)
const transferTargetOptions = computed(() => [
  {
    group: __('People'),
    options: (users.data ?? [])
      .filter((user) => user.enabled && user.name !== transferUser.value)
      .map((user) => ({ label: user.full_name, value: user.name, description: user.email })),
  },
  {
    group: __('Shared Drives'),
    options: (sharedDrives.data ?? []).map((drive) => ({
      label: drive.title,
      value: `drive:${drive.id}`,
      icon: 'lucide-hard-drive',
    })),
  },
])
const transferFolderTitle = computed(() => __("{0}'s files", [personName(transferUser.value)]))
function transferTo() {
  const target = transferTarget.value ?? ''
  return target.startsWith('drive:')
    ? { to_user: null, to_drive: target.slice('drive:'.length) }
    : { to_user: target, to_drive: null }
}
const confirmTransferAccess = ref(false)
const transferPreview = ref<OutputOf<typeof api.suite.users.previewTransfer>>()
const transferResults = ref<OutputOf<typeof api.suite.users.transferDrive>>()
const transfer = useMutation(api.suite.users.transferDrive)
const previewPending = ref(false)
/** Where the last batch went, kept after the preview clears so the result can name it. */
const movedTo = ref('')
const previewError = ref('')
const transferOpen = computed({
  get: () => !!transferUser.value,
  set: (open) => {
    if (!open) transferUser.value = ''
  },
})
watch(transferTarget, () => {
  transferPreview.value = undefined
  confirmTransferAccess.value = false
})
function openTransfer(user: string) {
  transferUser.value = user
  transferTarget.value = null
  confirmTransferAccess.value = false
  transferPreview.value = undefined
  transferResults.value = undefined
  previewError.value = ''
  transfer.reset()
}
const openedTransferUser = ref('')
watch(
  [() => props.initialTransferUser, () => users.data],
  ([name]) => {
    if (!name || openedTransferUser.value === name) return
    const user = users.data?.find((user) => user.name === name)
    if (!user || user.enabled) return
    openedTransferUser.value = name
    openTransfer(name)
  },
  { immediate: true },
)

const bytes = formatStorage

/** How many top-level items one transfer request moves (`transfer_user_drive`). */
const TRANSFER_BATCH = 50
const me = computed(() => useSession().user.value?.id)
function personName(email: string) {
  return users.data?.find((user) => user.name === email)?.full_name || email
}
const itemsText = computed(() => {
  const preview = transferPreview.value
  if (!preview) return ''
  return preview.item_count === 1
    ? __('1 item · {0}', [bytes(preview.bytes)])
    : __('{0} items · {1}', [preview.item_count, bytes(preview.bytes)])
})
const destinationText = computed(() => {
  const preview = transferPreview.value
  if (!preview) return ''
  return preview.destination_user
    ? __('“{0}” in {1}’s Drive', [preview.folder_title, preview.destination_title])
    : __('“{0}” in {1}', [preview.folder_title, preview.destination_title])
})
const storageText = computed(() => {
  const capacity = transferPreview.value?.destination_capacity
  if (!capacity) return ''
  if (capacity.current_bytes == null || capacity.projected_bytes == null)
    return __('Unknown right now')
  return capacity.cap_bytes == null
    ? __('{0} → {1}, no limit', [bytes(capacity.current_bytes), bytes(capacity.projected_bytes)])
    : __('{0} → {1} of {2}', [
        bytes(capacity.current_bytes),
        bytes(capacity.projected_bytes),
        bytes(capacity.cap_bytes),
      ])
})
const blockerText = computed(() =>
  transferPreview.value?.destination_capacity.blocker === 'unknown_usage'
    ? __('Destination usage is unavailable. Try again when storage can be measured.')
    : __(
        'The destination does not have enough storage. Choose another folder or increase its limit.',
      ),
)

function grantLabel(role: number) {
  switch (role) {
    case 10:
      return __('Read')
    case 20:
      return __('Comment')
    case 30:
      return __('Upload')
    case 40:
      return __('Edit')
    case 50:
      return __('Manage')
    default:
      return __('Access changes')
  }
}

async function previewTransfer() {
  confirmTransferAccess.value = false
  transferPreview.value = undefined
  previewError.value = ''
  previewPending.value = true
  try {
    transferPreview.value = await client.query(api.suite.users.previewTransfer, {
      user: transferUser.value,
      ...transferTo(),
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
    ...transferTo(),
    fingerprint: transferPreview.value.fingerprint,
    confirm_access: confirmTransferAccess.value,
  })
  movedTo.value = destinationText.value
  transferPreview.value = undefined
}

async function resetTransfer() {
  transferResults.value = undefined
  await previewTransfer()
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
      label: __('Edit storage limit'),
      icon: 'lucide-hard-drive',
      condition: () => !!storage.data?.cloud,
      onClick: () => {
        storageUsers.value = [user.name]
        storageEditing.value = true
      },
    },
    {
      label: user.is_admin ? __('Demote to member') : __('Make Admin'),
      icon: 'lucide-shield',
      // The last active Admin cannot step down; a disabled user is made Admin after reactivation.
      condition: () => (user.is_admin || !!user.enabled) && !lastAdmin(user),
      onClick: () => confirmUserChange(user, 'role'),
    },
    {
      label: user.enabled ? __('Disable user') : __('Reactivate user'),
      icon: user.enabled ? 'lucide-circle-off' : 'lucide-circle-play',
      // No one can disable their own account.
      condition: () => user.name !== me.value,
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
      label:
        user.setup_status === 'Setup failed' ? __('Retry Mail setup') : __('Recreate Mail account'),
      icon: 'lucide-refresh-cw',
      condition: () =>
        !!storage.data?.cloud &&
        !user.enabled &&
        user.setup_status !== 'Deletion failed' &&
        (!user.account || user.setup_status === 'Setup failed'),
      onClick: () => {
        recreatingUser.value = user.name
        retryingSetup.value = user.setup_status === 'Setup failed'
        recreatedAddress.value = retryingSetup.value ? user.account || user.email : ''
        recreationError.value = ''
        recreateMail.reset()
      },
    },
    {
      label:
        user.setup_status === 'Deletion failed'
          ? __('Retry Mail deletion')
          : __('Delete Mail account'),
      icon: 'lucide-trash-2',
      condition: () =>
        !!storage.data?.cloud &&
        !user.enabled &&
        (!!user.account || user.setup_status === 'Deletion failed'),
      onClick: () => {
        deletingUser.value = user
        deletionConfirmation.value = ''
        deletionError.value = ''
        deleteMail.reset()
      },
    },
    {
      label: __('Transfer Drive'),
      icon: 'lucide-folder-output',
      condition: () => !user.enabled,
      onClick: () => openTransfer(user.name),
    },
  ]
}

function lastAdmin(user: User) {
  const admins = (users.data ?? []).filter((entry) => entry.is_admin && entry.enabled)
  return user.name === me.value && admins.length === 1 && admins[0].name === user.name
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
    confirmLabel:
      kind === 'role'
        ? user.is_admin
          ? __('Demote to member')
          : __('Make Admin')
        : user.enabled
          ? __('Disable user')
          : __('Reactivate user'),
    theme: kind === 'enabled' && user.enabled ? 'red' : undefined,
    onConfirm: async () => {
      await change.run({
        user: user.name,
        ...(kind === 'role' ? { is_admin: !user.is_admin } : { enabled: !user.enabled }),
      })
    },
  })
}
</script>
