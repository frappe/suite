<template>
  <DashboardLayout
    area="admin"
    :breadcrumbs="[{ label: __('Storage') }]"
    :loading="report.status === 'pending'"
  >
    <template #actions>
      <Button
        variant="solid"
        :label="__('Refresh Mail usage')"
        :loading="refresh.isPending"
        :disabled="!report.data?.cloud"
        @click="refresh.run({})"
      />
    </template>

    <ErrorMessage
      :message="
        report.error?.message ||
        refresh.error?.message ||
        saveDefault.error?.message ||
        saveBuffers.error?.message
      "
    />

    <div v-if="report.data" class="mx-auto w-full max-w-4xl space-y-8 pb-10">
      <div class="space-y-1">
        <p v-if="report.data.stale" class="text-p-sm text-ink-amber-6">
          {{ __('Mail usage is out of date. Refresh to see the latest usage.') }}
        </p>
        <p v-if="report.data.fetched_at" class="text-p-sm text-ink-gray-5">
          {{ __('Mail usage last updated: {0}', [report.data.fetched_at]) }}
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          :icon="'lucide-database'"
          :value="bytes(report.data.combined_bytes)"
          :label="report.data.cloud ? __('Combined stored usage') : __('Drive stored usage')"
          :meta="__('Uploads in progress: {0}', [bytes(report.data.reserved_bytes)])"
        />
        <StatCard
          icon="lucide-hard-drive"
          :value="
            report.data.cloud
              ? __('{0} / {1}', [bytes(report.data.drive_bytes), bytes(report.data.mail_bytes)])
              : bytes(report.data.drive_bytes)
          "
          :label="report.data.cloud ? __('Drive / Mail') : __('Drive usage')"
          :meta="
            __('Personal: {0} · Shared: {1}', [
              bytes(report.data.personal_drive_bytes),
              bytes(report.data.shared_drive_bytes),
            ])
          "
        />
        <StatCard
          icon="lucide-gauge"
          :value="
            !report.data.cloud
              ? __('Local quotas')
              : report.data.allowance_bytes === null
                ? __('Unavailable')
                : report.data.allowance_bytes === 0
                  ? __('Uncapped')
                  : bytes(report.data.effective_allowance_bytes)
          "
          :label="__('Storage limit')"
        />
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 text-p-sm text-ink-gray-6">
        <p v-if="report.data.cloud">
          {{
            __('Group Mail: {0} · {1} pending invitations', [
              bytes(report.data.group_mail_bytes),
              report.data.pending_invitations,
            ])
          }}
        </p>
        <Button
          variant="ghost"
          :label="__('Manage {0} users', [report.data.users.length])"
          route="/admin/users"
        />
      </div>

      <div v-if="report.data.cloud && alerts.length" class="space-y-1">
        <p v-for="alert in alerts" :key="alert" class="text-p-sm text-ink-amber-6">
          {{ alert }}
        </p>
      </div>

      <template v-if="report.data.cloud">
        <section
          class="flex flex-col justify-between gap-4 border-b border-outline-gray-2 pb-6 sm:flex-row sm:items-center"
        >
          <div class="max-w-sm">
            <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Future users') }}</h2>
            <p class="mt-1.5 text-p-sm text-ink-gray-5">
              {{
                __(
                  'The initial personal cap for newly created users. Existing users and invitations keep their current caps.',
                )
              }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <FormControl
              v-model="defaultGB"
              type="number"
              :label="__('Default cap (GB)')"
              :placeholder="__('Uncapped')"
              class="w-40"
            />
            <Button
              variant="subtle"
              :label="__('Save default')"
              :loading="saveDefault.isPending"
              @click="saveDefault.run({ cap_bytes: cap(defaultGB) })"
            />
          </div>
        </section>

        <section class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Personal storage caps') }}</h2>
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="selected.length" class="text-p-sm text-ink-gray-5">{{
                __('{0} selected', [selected.length])
              }}</span>
              <Button
                variant="subtle"
                :label="__('Set caps')"
                :disabled="!selected.length"
                @click="editing = true"
              />
              <Button
                variant="ghost"
                :label="__('Grant 10% headroom')"
                :disabled="!selected.length"
                :loading="saveBuffers.isPending"
                @click="reviewBuffers(true)"
              />
              <Button
                variant="ghost"
                :label="__('Revoke headroom')"
                :disabled="!selected.length"
                :loading="saveBuffers.isPending"
                @click="reviewBuffers(false)"
              />
            </div>
          </div>

          <List
            v-model:selection="selected"
            selectable
            class="-mx-3 list-row-px-3"
            :columns="['minmax(0,1fr)', '11rem', '12rem']"
            :row-height="72"
          >
            <ListHeader>
              <ListHeaderCell>{{ __('User') }}</ListHeaderCell>
              <ListHeaderCell>{{ __('Usage') }}</ListHeaderCell>
              <ListHeaderCell>{{ __('Effective cap') }}</ListHeaderCell>
            </ListHeader>
            <ListRow v-for="user in report.data.users" :key="user.name" :value="user.name">
              <ListCell>
                <Avatar :label="user.full_name" size="sm" />
                <div class="ml-3 min-w-0">
                  <p class="truncate text-base text-ink-gray-8">{{ user.full_name }}</p>
                  <p class="truncate text-p-sm text-ink-gray-5">{{ user.email }}</p>
                </div>
              </ListCell>
              <ListCell>
                <div class="min-w-0">
                  <p class="truncate text-base text-ink-gray-8">{{ bytes(user.combined_bytes) }}</p>
                  <p class="truncate text-p-sm text-ink-gray-5">{{ usageMeta(user) }}</p>
                  <p
                    v-if="capNote(user)"
                    class="truncate text-p-sm text-ink-amber-6"
                    :title="capNote(user)"
                  >
                    {{ capNote(user) }}
                  </p>
                </div>
              </ListCell>
              <ListCell>
                <div class="flex min-w-0 items-center justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate text-base text-ink-gray-7">
                      {{
                        user.effective_cap_bytes === null
                          ? __('Uncapped')
                          : bytes(user.effective_cap_bytes)
                      }}
                    </p>
                    <p v-if="user.cap_bytes" class="truncate text-p-sm text-ink-gray-5">
                      {{ __('Base: {0}', [bytes(user.cap_bytes)])
                      }}{{ user.buffer ? __(' · +10%') : '' }}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    icon="lucide-pencil"
                    :label="__('Edit cap for {0}', [user.full_name])"
                    @click="editCap(user)"
                  />
                </div>
              </ListCell>
            </ListRow>
          </List>

          <p
            v-for="result in bufferResults"
            :key="result.user"
            class="text-p-sm"
            :class="result.success ? 'text-ink-green-6' : 'text-ink-red-6'"
          >
            {{ result.user }}: {{ result.success ? __('Saved') : result.error }}
          </p>
        </section>
      </template>

      <section v-else class="space-y-4">
        <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Drive roots') }}</h2>
        <List
          class="-mx-3 list-row-px-3"
          :columns="['minmax(0,1fr)', '9rem', '12rem']"
          :row-height="44"
        >
          <ListHeader>
            <ListHeaderCell>{{ __('Root') }}</ListHeaderCell>
            <ListHeaderCell>{{ __('Stored usage') }}</ListHeaderCell>
            <ListHeaderCell>{{ __('Local quota') }}</ListHeaderCell>
          </ListHeader>
          <ListRow v-for="root in report.data.roots" :key="root.name" :value="root.name">
            <ListCell>
              <span
                :class="root.user ? 'lucide-user-round' : 'lucide-users-round'"
                class="size-4 shrink-0 text-ink-gray-5"
                aria-hidden="true"
              />
              <span class="ml-3 truncate text-base text-ink-gray-8">
                {{ root.user || __('Shared Drive') }}
              </span>
              <span class="ml-2 truncate text-p-sm text-ink-gray-5">{{ root.state }}</span>
            </ListCell>
            <ListCell>
              <span class="text-base text-ink-gray-7">{{ bytes(root.stored_bytes) }}</span>
            </ListCell>
            <ListCell>
              <div class="flex items-center justify-between gap-2">
                <span class="text-base text-ink-gray-7">
                  {{
                    root.effective_quota_bytes ? bytes(root.effective_quota_bytes) : __('Uncapped')
                  }}
                </span>
                <Button
                  variant="ghost"
                  icon="lucide-pencil"
                  :label="
                    root.user
                      ? __('Edit quota for {0}', [root.user])
                      : __('Edit quota for the shared Drive')
                  "
                  @click="editLocalQuota(root)"
                />
              </div>
            </ListCell>
          </ListRow>
        </List>
      </section>
    </div>

    <Dialog
      v-model:open="editing"
      :title="__('Set personal caps')"
      :dismissible="!saveLimits.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <p class="text-p-base text-ink-gray-7">
            {{
              __(
                'Each selected user receives this cap. Existing files are preserved if usage already exceeds it.',
              )
            }}
          </p>
          <FormControl
            v-model="limitGB"
            type="number"
            :label="__('Personal cap (GB)')"
            :description="__('Leave blank to remove caps and clear headroom grants.')"
          />
          <p v-for="user in selectedUsers" :key="user.name" class="text-p-sm text-ink-gray-5">
            {{ __('{0}: {1} stored', [user.full_name, bytes(user.combined_bytes)]) }}
          </p>
          <FormControl
            v-model="bufferChoice"
            type="select"
            :label="__('10% headroom')"
            :options="[
              { label: __('Keep existing grants'), value: 'keep' },
              { label: __('Grant'), value: 'grant' },
              { label: __('Revoke'), value: 'revoke' },
            ]"
          />
          <ErrorMessage :message="saveLimits.error?.message" />
          <p
            v-for="result in results"
            :key="result.user"
            class="text-p-sm"
            :class="result.success ? 'text-ink-green-6' : 'text-ink-red-6'"
          >
            {{ result.user }}: {{ result.success ? __('Saved') : result.error }}
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button :label="__('Cancel')" :disabled="saveLimits.isPending" @click="editing = false" />
          <Button
            variant="solid"
            :label="__('Apply')"
            :loading="saveLimits.isPending"
            @click="applyLimits"
          />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:open="reviewingBuffers"
      :title="bufferGrant ? __('Grant 10% headroom') : __('Revoke headroom')"
      :dismissible="!saveBuffers.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <p class="text-p-base text-ink-gray-7">
            {{
              __(
                'Each selected capped user receives or loses 10% of their own current cap. Over-threshold data is retained; only new Drive growth is affected.',
              )
            }}
          </p>
          <ul class="space-y-1">
            <li v-for="user in selectedUsers" :key="user.name" class="text-p-sm text-ink-gray-6">
              {{ user.full_name }}: {{ bytes(user.combined_bytes) }} /
              {{
                user.cap_bytes == null
                  ? __('no cap; this user will be skipped')
                  : bytes(user.cap_bytes + (bufferGrant ? Math.floor(user.cap_bytes / 10) : 0))
              }}
            </li>
          </ul>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button
            :label="__('Cancel')"
            :disabled="saveBuffers.isPending"
            @click="reviewingBuffers = false"
          />
          <Button
            variant="solid"
            :label="bufferGrant ? __('Grant') : __('Revoke')"
            :loading="saveBuffers.isPending"
            @click="applyBuffers(bufferGrant).then(() => (reviewingBuffers = false))"
          />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:open="localQuotaOpen"
      :title="__('Local Drive quota')"
      :dismissible="!saveLocalQuota.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <FormControl
            v-model="localQuotaGB"
            type="number"
            :label="__('Quota (decimal GB)')"
            :description="
              __('Zero uses the existing site default. Lowering a quota preserves files.')
            "
          />
          <ErrorMessage :message="saveLocalQuota.error?.message" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button
            :label="__('Cancel')"
            :disabled="saveLocalQuota.isPending"
            @click="localQuotaOpen = false"
          />
          <Button
            variant="solid"
            :label="__('Save')"
            :loading="saveLocalQuota.isPending"
            @click="applyLocalQuota"
          />
        </div>
      </template>
    </Dialog>
  </DashboardLayout>
</template>

<script setup lang="ts">
import { Avatar, Button, Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import { DashboardLayout, StatCard } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

type StorageUser = OutputOf<typeof api.suite.storage.get>['users'][number]
type StorageRoot = OutputOf<typeof api.suite.storage.get>['roots'][number]

const report = useQuery(api.suite.storage.get)
const health = useQuery(api.suite.admin.health)
const refresh = useMutation(api.suite.storage.refresh)
const saveLimits = useMutation(api.suite.storage.setLimits)
const saveDefault = useMutation(api.suite.storage.setDefault)
const saveBuffers = useMutation(api.suite.storage.setBuffers)
const saveLocalQuota = useMutation(api.drive.roots.setQuota)

const alerts = computed(() => {
  const data = report.data
  if (!data?.cloud) return []
  const rows = [...(health.data?.alerts ?? [])]
  if (
    data.allowance_bytes &&
    data.combined_bytes != null &&
    data.combined_bytes >= data.allowance_bytes * 0.9
  ) {
    rows.unshift(
      data.combined_bytes > (data.effective_allowance_bytes ?? data.allowance_bytes)
        ? __(
            'The site is above its effective threshold. New Drive growth is blocked; Mail continues.',
          )
        : data.combined_bytes > data.allowance_bytes
          ? __('The site is using its automatic 10% headroom. Mail continues.')
          : __('The site is near its base allowance. Mail continues.'),
    )
  }
  return rows
})

// — future-user default —
const defaultGB = ref('')
watch(
  () => report.data?.default_cap_bytes,
  (value) => {
    defaultGB.value = value == null ? '' : String(value / 1_000_000_000)
  },
)

// — personal caps —
const selected = ref<string[]>([])
const selectedUsers = computed(
  () => report.data?.users.filter((user) => selected.value.includes(user.name)) || [],
)
const editing = ref(false)
const limitGB = ref('')
const bufferChoice = ref('keep')
const results = ref<OutputOf<typeof api.suite.storage.setLimits>>([])
const bufferResults = ref<OutputOf<typeof api.suite.storage.setBuffers>>([])
const reviewingBuffers = ref(false)
const bufferGrant = ref(false)

function reviewBuffers(grant: boolean) {
  bufferGrant.value = grant
  reviewingBuffers.value = true
}

function editCap(user: StorageUser) {
  selected.value = [user.name]
  limitGB.value = user.cap_bytes == null ? '' : String(user.cap_bytes / 1_000_000_000)
  bufferChoice.value = 'keep'
  results.value = []
  saveLimits.reset()
  editing.value = true
}

async function applyLimits() {
  results.value = await saveLimits.run({
    users: selected.value,
    cap_bytes: cap(limitGB.value),
    ...(bufferChoice.value === 'keep' ? {} : { buffer: bufferChoice.value === 'grant' }),
  })
}

async function applyBuffers(grant: boolean) {
  bufferResults.value = await saveBuffers.run({ users: selected.value, grant })
}

function usageMeta(user: StorageUser) {
  if (user.mail_bytes == null) return __('Drive: {0}', [bytes(user.drive_bytes)])
  return __('Drive: {0} · Mail: {1}', [bytes(user.drive_bytes), bytes(user.mail_bytes)])
}

function capNote(user: StorageUser): string | undefined {
  if (!user.cap_bytes || user.combined_bytes == null) return undefined
  if (user.combined_bytes < user.cap_bytes * 0.9) return undefined
  if (user.combined_bytes > (user.effective_cap_bytes ?? user.cap_bytes)) return __('Over cap')
  if (user.combined_bytes > user.cap_bytes) return __('Using headroom')
  return __('Near cap')
}

// — local Drive quotas —
const localRoot = ref('')
const localQuotaGB = ref('0')
const localQuotaOpen = computed({
  get: () => !!localRoot.value,
  set: (open) => {
    if (!open) localRoot.value = ''
  },
})

function editLocalQuota(root: StorageRoot) {
  localRoot.value = root.name
  localQuotaGB.value = String(root.quota_bytes / 1_000_000_000)
  saveLocalQuota.reset()
}

async function applyLocalQuota() {
  await saveLocalQuota.run({
    root: localRoot.value,
    quota_bytes: localQuotaGB.value === '0' ? 0 : (cap(localQuotaGB.value) ?? 0),
  })
  localRoot.value = ''
  await report.refetch()
}

// — formatting and parsing —
function bytes(value: number | null) {
  if (value === null) return __('Unavailable')
  return __('{0} GB', [
    (value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
  ])
}

function cap(value: string): number | null {
  if (!value.trim()) return null
  const amount = Number(value) * 1_000_000_000
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(__('Enter a positive cap'))
  return amount
}
</script>
