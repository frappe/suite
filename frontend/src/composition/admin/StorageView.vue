<template>
  <DashboardLayout
    area="admin"
    :breadcrumbs="[{ label: __('Storage') }]"
    :loading="report.status === 'pending'"
  >
    <template #loading>
      <div class="mx-auto w-full max-w-5xl space-y-6 pb-10" aria-hidden="true">
        <SiteStorageSummarySkeleton />
        <section
          class="flex flex-col justify-between gap-4 border-b border-outline-gray-2 pb-6 sm:flex-row sm:items-center"
        >
          <div class="max-w-sm">
            <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Default for new users') }}</h2>
            <p class="mt-1.5 text-p-sm text-ink-gray-5">
              {{ __('Existing users and invitations won’t change.') }}
            </p>
          </div>
          <div class="flex items-end gap-2">
            <div class="w-40 space-y-1.5">
              <DashboardSkeletonText class="text-sm" width="70%" />
              <Skeleton class="h-7 w-full rounded-4" />
            </div>
            <Skeleton class="h-7 w-12 rounded-4" />
          </div>
        </section>
        <section class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg font-medium text-ink-gray-9">{{ __('User storage limits') }}</h2>
            <div class="flex flex-wrap items-center gap-2">
              <Skeleton class="h-7 w-20 rounded-4" />
            </div>
          </div>
          <List
            selectable
            class="pointer-events-none -mx-3 list-row-px-3"
            :columns="['minmax(0,1fr)', '11rem', '12rem']"
            :row-height="72"
          >
            <ListHeader>
              <ListHeaderCell>{{ __('User') }}</ListHeaderCell>
              <ListHeaderCell>{{ __('Usage') }}</ListHeaderCell>
              <ListHeaderCell>{{ __('Limit') }}</ListHeaderCell>
            </ListHeader>
            <ListRows v-slot="{ item }" :items="SKELETON_ROWS" row-key="id">
              <ListRow :value="item.id">
                <ListCell>
                  <Skeleton class="size-6 shrink-0 rounded-full" />
                  <div class="ml-3 min-w-0 flex-1">
                    <DashboardSkeletonText class="text-base" width="35%" />
                    <DashboardSkeletonText class="text-p-sm" width="50%" />
                  </div>
                </ListCell>
                <ListCell>
                  <div class="min-w-0 flex-1">
                    <DashboardSkeletonText class="text-base" width="60%" />
                    <DashboardSkeletonText class="text-p-sm" width="45%" />
                  </div>
                </ListCell>
                <ListCell>
                  <DashboardSkeletonText class="flex-1 text-base" width="50%" />
                </ListCell>
              </ListRow>
            </ListRows>
          </List>
        </section>
      </div>
    </template>
    <ErrorMessage :message="report.error?.message || saveDefault.error?.message" />

    <div v-if="report.data" class="mx-auto w-full max-w-5xl space-y-6 pb-10">
      <SiteStorageSummary :report="report.data" />

      <template v-if="report.data.cloud">
        <section
          class="flex flex-col justify-between gap-4 border-b border-outline-gray-2 pb-6 sm:flex-row sm:items-center"
        >
          <div class="max-w-sm">
            <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Default for new users') }}</h2>
            <p class="mt-1.5 text-p-sm text-ink-gray-5">
              {{ __('Existing users and invitations won’t change.') }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <FormControl
              v-model="defaultGB"
              type="number"
              :label="__('Storage limit (GB)')"
              :placeholder="__('No limit')"
              class="w-40"
            />
            <Button
              variant="subtle"
              :label="__('Save')"
              :loading="saveDefault.isPending"
              @click="saveDefault.run({ cap_bytes: cap(defaultGB) })"
            />
          </div>
        </section>

        <section class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg font-medium text-ink-gray-9">{{ __('User storage limits') }}</h2>
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="selected.length" class="text-p-sm text-ink-gray-5">{{
                __('{0} selected', [selected.length])
              }}</span>
              <Button
                variant="subtle"
                :label="__('Set limits')"
                :disabled="!selected.length"
                @click="editing = true"
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
              <ListHeaderCell>{{ __('Limit') }}</ListHeaderCell>
            </ListHeader>
            <ListRows v-slot="{ item: user, value }" :items="report.data.users">
              <ListRow :value="value">
                <ListCell>
                  <Avatar :label="user.full_name" size="sm" />
                  <div class="ml-3 min-w-0">
                    <p class="truncate text-base text-ink-gray-8">{{ user.full_name }}</p>
                    <p class="truncate text-p-sm text-ink-gray-5">{{ user.email }}</p>
                  </div>
                </ListCell>
                <ListCell>
                  <div class="min-w-0 flex-1 space-y-1 pe-6">
                    <StorageUsage :user="user" :show-limit="false" />
                    <p v-if="user.mail_bytes !== null" class="truncate text-p-sm text-ink-gray-5">
                      {{ usageMeta(user) }}
                    </p>
                    <p
                      v-if="capNote(user)"
                      class="flex min-w-0 items-center gap-1 text-p-sm text-ink-gray-6"
                      :title="capNote(user)"
                    >
                      <span
                        class="lucide-triangle-alert size-3 shrink-0 text-ink-amber-6"
                        aria-hidden="true"
                      />
                      <span class="truncate">{{ capNote(user) }}</span>
                    </p>
                  </div>
                </ListCell>
                <ListCell>
                  <div class="flex min-w-0 items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-base text-ink-gray-7">
                        {{ storageLimit(user) }}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      icon="lucide-pencil"
                      :label="__('Edit storage limit for {0}', [user.full_name])"
                      @click="editCap(user)"
                    />
                  </div>
                </ListCell>
              </ListRow>
            </ListRows>
          </List>
        </section>
      </template>

      <section v-else class="space-y-4">
        <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Drive storage') }}</h2>
        <List
          class="-mx-3 list-row-px-3"
          :columns="['minmax(0,1fr)', '9rem', '12rem']"
          :row-height="44"
        >
          <ListHeader>
            <ListHeaderCell>{{ __('Drive') }}</ListHeaderCell>
            <ListHeaderCell>{{ __('Used') }}</ListHeaderCell>
            <ListHeaderCell>{{ __('Limit') }}</ListHeaderCell>
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
              <span class="text-base text-ink-gray-7">{{ formatStorage(root.stored_bytes) }}</span>
            </ListCell>
            <ListCell>
              <div class="flex items-center justify-between gap-2">
                <span class="text-base text-ink-gray-7">
                  {{
                    root.effective_quota_bytes
                      ? formatStorage(root.effective_quota_bytes)
                      : __('No limit')
                  }}
                </span>
                <Button
                  variant="ghost"
                  icon="lucide-pencil"
                  :label="
                    root.user
                      ? __('Edit storage limit for {0}', [root.user])
                      : __('Edit storage limit for the shared Drive')
                  "
                  @click="editLocalQuota(root)"
                />
              </div>
            </ListCell>
          </ListRow>
        </List>
      </section>
    </div>

    <StorageLimitDialog v-model:open="editing" :users="selected" :close-on-success="false" />

    <Dialog
      v-model:open="localQuotaOpen"
      :title="__('Drive storage limit')"
      :dismissible="!saveLocalQuota.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <FormControl
            v-model="localQuotaGB"
            type="number"
            :label="__('Storage limit (GB)')"
            :description="
              __('Enter 0 to use the workspace default. Existing files won’t be deleted.')
            "
          />
          <ErrorMessage :message="saveLocalQuota.error?.message" />
        </div>
      </template>
      <template #actions>
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
import { Avatar, Button, Dialog, ErrorMessage, FormControl, Skeleton } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { computed, defineAsyncComponent, ref, watch } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import { loadStorageLimitDialog } from '@/apps/mail'
import { DashboardLayout, DashboardSkeletonText } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

import SiteStorageSummary from './SiteStorageSummary.vue'
import SiteStorageSummarySkeleton from './SiteStorageSummarySkeleton.vue'
import { formatStorage, storageLimit } from './storageFormat'
import StorageUsage from './StorageUsage.vue'

type StorageUser = OutputOf<typeof api.suite.storage.get>['users'][number]
type StorageRoot = OutputOf<typeof api.suite.storage.get>['roots'][number]

const SKELETON_ROWS = Array.from({ length: 6 }, (_, index) => ({ id: `skeleton-${index}` }))

const report = useQuery(api.suite.storage.get)
const StorageLimitDialog = defineAsyncComponent(loadStorageLimitDialog)
const saveDefault = useMutation(api.suite.storage.setDefault)
const saveLocalQuota = useMutation(api.drive.roots.setQuota)

// — future-user default —
const defaultGB = ref('')
watch(
  () => report.data?.default_cap_bytes,
  (value) => {
    defaultGB.value = value == null ? '' : String(value / 1_000_000_000)
  },
  { immediate: true },
)

// — personal caps —
const selected = ref<string[]>([])
const editing = ref(false)

function editCap(user: StorageUser) {
  selected.value = [user.name]
  editing.value = true
}

function usageMeta(user: StorageUser) {
  return __('Drive {0} · Mail {1}', [
    formatStorage(user.drive_bytes),
    formatStorage(user.mail_bytes ?? 0),
  ])
}

function capNote(user: StorageUser): string | undefined {
  if (!user.cap_bytes || user.combined_bytes == null) return undefined
  if (user.combined_bytes < user.cap_bytes * 0.9) return undefined
  if (user.combined_bytes > (user.effective_cap_bytes ?? user.cap_bytes)) return __('Storage full')
  if (user.combined_bytes > user.cap_bytes) return __('Using extra storage')
  return __('Almost full')
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
function cap(value: string): number | null {
  if (!value.trim()) return null
  const amount = Number(value) * 1_000_000_000
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error(__('Enter a storage limit greater than zero'))
  return amount
}
</script>
