<template>
  <DashboardLayout
    area="admin"
    :breadcrumbs="[{ label: __('Storage') }]"
    :loading="report.status === 'pending'"
  >
    <template #loading>
      <div class="mx-auto w-full max-w-5xl space-y-6 pb-10" aria-hidden="true">
        <SiteStorageSummarySkeleton />
        <section class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg font-medium text-ink-gray-9">{{ __('User storage limits') }}</h2>
            <div class="flex flex-wrap items-center gap-2">
              <Skeleton class="h-7 w-20 rounded-4" />
            </div>
          </div>
          <List
            selectable
            class="pointer-events-none -mx-3 list-row-px-3 list-gap-2 sm:list-gap-6"
            :columns="{
              base: ['minmax(0,1fr)', '2rem'],
              sm: ['minmax(0,1fr)', '16rem', '2rem'],
            }"
            :row-height="64"
          >
            <ListHeader>
              <ListHeaderCell>{{ __('User') }}</ListHeaderCell>
              <ListHeaderCell class="max-sm:hidden">{{ __('Usage') }}</ListHeaderCell>
              <ListHeaderCell />
            </ListHeader>
            <ListRows v-slot="{ item }" :items="SKELETON_ROWS" row-key="id">
              <ListRow :value="item.id" class="h-auto gap-y-2 py-3 sm:h-16 sm:py-0">
                <ListCell>
                  <Skeleton class="size-6 shrink-0 rounded-full" />
                  <div class="ml-3 min-w-0 flex-1">
                    <DashboardSkeletonText class="text-base" width="35%" />
                    <DashboardSkeletonText class="text-p-sm" width="50%" />
                  </div>
                </ListCell>
                <ListCell class="max-sm:col-start-1 max-sm:row-start-2">
                  <div class="min-w-0 flex-1">
                    <DashboardSkeletonText class="text-base" width="60%" />
                    <DashboardSkeletonText class="text-p-sm" width="45%" />
                  </div>
                </ListCell>
                <ListCell class="max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1">
                  <Skeleton class="size-7 rounded-4" />
                </ListCell>
              </ListRow>
            </ListRows>
          </List>
        </section>
      </div>
    </template>
    <ErrorMessage :message="report.error?.message" />

    <div v-if="report.data" class="mx-auto w-full max-w-5xl space-y-6 pb-10">
      <SiteStorageSummary :report="report.data" compact />

      <template v-if="report.data.cloud">
        <section v-if="attentionUsers.length" class="space-y-3" :aria-label="__('Storage alerts')">
          <h2 class="text-lg-medium text-ink-gray-9">{{ __('Needs attention') }}</h2>
          <div class="grid gap-3 lg:grid-cols-2">
            <div
              v-for="user in attentionUsers"
              :key="user.name"
              class="space-y-3 rounded-5 border border-outline-gray-2 p-4"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-base-medium text-ink-gray-9">{{ user.full_name }}</p>
                  <p class="break-all text-p-sm text-ink-gray-5">{{ user.email }}</p>
                </div>
                <Badge
                  :theme="
                    user.combined_bytes !== null &&
                    user.combined_bytes > (user.effective_cap_bytes ?? user.cap_bytes ?? Infinity)
                      ? 'red'
                      : 'amber'
                  "
                  >{{ capNote(user) }}</Badge
                >
              </div>
              <StorageUsage :user="user" />
              <div class="flex items-center justify-between gap-3">
                <p class="text-p-sm text-ink-gray-5">{{ __('Mail keeps working') }}</p>
                <Button :label="__('Review limit')" @click="editCap(user)" />
              </div>
            </div>
          </div>
        </section>
        <section class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg-medium text-ink-gray-9">{{ __('User storage limits') }}</h2>
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="selected.length" class="text-p-sm text-ink-gray-5">{{
                __('{0} selected', [selected.length])
              }}</span>
              <Button variant="ghost" :label="__('Default storage')" @click="openDefaultStorage" />
              <Button
                v-if="selected.length"
                variant="solid"
                :label="__('Set limits')"
                @click="editing = true"
              />
            </div>
          </div>
          <div class="flex items-center justify-between gap-2">
            <FormControl
              v-model="search"
              :aria-label="__('Search users')"
              :placeholder="__('Search users')"
              class="min-w-0 flex-1 sm:max-w-64"
            />
            <div class="flex shrink-0 gap-2">
              <FormControl
                v-model="filter"
                class="w-28 sm:w-auto"
                type="select"
                :aria-label="__('Filter users')"
                :options="[
                  { label: __('All users'), value: 'all' },
                  { label: __('Needs attention'), value: 'attention' },
                ]"
              />
              <Button
                icon="lucide-arrow-down-up"
                :label="descending ? __('Most used first') : __('Least used first')"
                @click="descending = !descending"
              />
            </div>
          </div>
          <List
            v-model:selection="selected"
            selectable
            class="storage-users -mx-3 list-row-px-3 list-gap-3 sm:list-gap-6"
            :columns="{
              base: ['minmax(0,1fr)', '2rem'],
              sm: ['minmax(0,1fr)', '16rem', '2rem'],
            }"
            :row-height="72"
          >
            <ListHeader>
              <ListHeaderCell>{{ __('User') }}</ListHeaderCell>
              <ListHeaderCell class="max-sm:hidden">{{ __('Used') }}</ListHeaderCell>
              <ListHeaderCell />
            </ListHeader>
            <ListRows v-slot="{ item: user, value }" :items="visibleUsers">
              <ListRow :value="value" class="h-auto gap-y-3 py-4 sm:h-[72px] sm:py-0">
                <ListCell>
                  <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 sm:block">
                    <p class="break-words text-base text-ink-gray-8 sm:truncate">
                      {{ user.full_name }}
                    </p>
                    <p class="min-w-0 break-words text-p-sm text-ink-gray-5 sm:truncate">
                      {{ user.email }}
                    </p>
                  </div>
                </ListCell>
                <ListCell class="max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-2">
                  <StorageUsage :user="user" />
                </ListCell>
                <ListCell class="max-sm:col-start-2 max-sm:row-start-1 max-sm:self-start">
                  <Button
                    variant="ghost"
                    icon="lucide-pencil"
                    :label="__('Edit storage limit for {0}', [user.email])"
                    @click.stop="editCap(user)"
                  />
                </ListCell>
              </ListRow>
            </ListRows>
          </List>
          <p v-if="!visibleUsers.length" class="py-6 text-center text-p-sm text-ink-gray-5">
            {{ __('No users found') }}
          </p>
        </section>
      </template>

      <section v-else class="space-y-4">
        <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Drive storage') }}</h2>
        <List
          class="-mx-3 list-row-px-3"
          :columns="{
            base: ['minmax(0,1fr)', '4rem', '6rem'],
            sm: ['minmax(0,1fr)', '9rem', '12rem'],
          }"
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

    <Dialog
      v-model:open="defaultStorageOpen"
      :title="__('Default storage for new users')"
      :dismissible="!saveDefault.isPending"
    >
      <template #default>
        <div class="space-y-4">
          <p class="text-p-sm text-ink-gray-5">
            {{ __('Existing users and invitations won’t change.') }}
          </p>
          <FormControl
            v-model="defaultGB"
            type="number"
            min="0"
            :label="__('Storage limit (GB)')"
            :placeholder="__('No limit')"
          />
          <ErrorMessage :message="defaultValidationError || saveDefault.error?.message" />
        </div>
      </template>
      <template #actions>
        <div class="flex justify-end gap-2">
          <Button
            :label="__('Cancel')"
            :disabled="saveDefault.isPending"
            @click="defaultStorageOpen = false"
          />
          <Button
            variant="solid"
            :label="__('Save')"
            :loading="saveDefault.isPending"
            @click="applyDefaultStorage"
          />
        </div>
      </template>
    </Dialog>

    <StorageLimitDialog v-model:open="editing" :users="selected" />

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
import { Badge, Button, Dialog, ErrorMessage, FormControl, Skeleton } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { computed, defineAsyncComponent, ref, watch } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import { loadStorageLimitDialog } from '@/apps/mail'
import { DashboardLayout, DashboardSkeletonText } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

import SiteStorageSummary from './SiteStorageSummary.vue'
import SiteStorageSummarySkeleton from './SiteStorageSummarySkeleton.vue'
import { formatStorage, storageUsed } from './storageFormat'
import StorageUsage from './StorageUsage.vue'

type StorageUser = OutputOf<typeof api.suite.storage.get>['users'][number]
type StorageRoot = OutputOf<typeof api.suite.storage.get>['roots'][number]

const SKELETON_ROWS = Array.from({ length: 6 }, (_, index) => ({ id: `skeleton-${index}` }))

const report = useQuery(api.suite.storage.get)
const StorageLimitDialog = defineAsyncComponent(loadStorageLimitDialog)
const saveDefault = useMutation(api.suite.storage.setDefault)
const saveLocalQuota = useMutation(api.drive.roots.setQuota)

// — future-user default —
const defaultStorageOpen = ref(false)
const defaultGB = ref('')
const defaultValidationError = ref('')
watch(
  () => report.data?.default_cap_bytes,
  (value) => {
    defaultGB.value = value == null ? '' : String(value / 1_000_000_000)
  },
  { immediate: true },
)

function openDefaultStorage() {
  defaultValidationError.value = ''
  saveDefault.reset()
  defaultStorageOpen.value = true
}

async function applyDefaultStorage() {
  defaultValidationError.value = ''
  let capBytes: number | null
  try {
    capBytes = cap(defaultGB.value)
  } catch (error) {
    defaultValidationError.value = error instanceof Error ? error.message : String(error)
    return
  }
  await saveDefault.run({ cap_bytes: capBytes })
  defaultStorageOpen.value = false
}

// — personal caps —
const selected = ref<string[]>([])
const editing = ref(false)
const search = ref('')
const filter = ref('all')
const descending = ref(true)
const attentionUsers = computed(() => (report.data?.users ?? []).filter((user) => capNote(user)))
const visibleUsers = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return (report.data?.users ?? [])
    .filter(
      (user) =>
        (!query || `${user.full_name} ${user.email}`.toLocaleLowerCase().includes(query)) &&
        (filter.value !== 'attention' || capNote(user)),
    )
    .slice()
    .sort((a, b) => (storageUsed(a) - storageUsed(b)) * (descending.value ? -1 : 1))
})

function editCap(user: StorageUser) {
  selected.value = [user.name]
  editing.value = true
}

function capNote(user: StorageUser): string | undefined {
  if (!user.cap_bytes || user.combined_bytes == null) return undefined
  if (user.combined_bytes < user.cap_bytes * 0.9) return undefined
  if (user.combined_bytes > (user.effective_cap_bytes ?? user.cap_bytes)) return __('Storage full')
  if (user.combined_bytes > user.cap_bytes) return __('Storage limit reached')
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

<style scoped>
@media (max-width: 639px) {
  .storage-users :deep([data-slot='list-row-checkbox']) {
    top: 8px;
    bottom: auto;
    height: 44px;
  }
}
</style>
