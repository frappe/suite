<template>
  <!-- The search's filters, on the results they narrow: one change, one new search, no palette. Each
       writes the route, which the list below already reads. On a phone they scroll sideways in one
       row, so the list doesn't start a third of the way down the screen. -->
  <div
    class="flex items-center gap-1.5"
    :class="isMobile ? 'overflow-x-auto px-3 py-2 [scrollbar-width:none]' : 'flex-wrap'"
  >
    <template v-if="tweaks.filters === 'pills'">
      <SearchFilterPill
        :label="__('From')"
        :value="query.from"
        @clear="update(withFilter(query, 'from'))"
      >
        <template #default="{ close }">
          <ContactCombobox
            :model-value="query.from"
            :label="__('Sender')"
            @update:model-value="
              (value?: string) => {
                update(withFilter(query, 'from', value))
                close()
              }
            "
          />
        </template>
      </SearchFilterPill>

      <SearchFilterPill
        :label="__('Date')"
        :value="dateLabel"
        @clear="update(withFilter(withFilter(query, 'after'), 'before'))"
      >
        <template #default="{ close }">
          <SearchFilterChoices
            :choices="datePresets"
            :selected="activeDatePreset(query)"
            @pick="
              (preset) => {
                update(
                  withFilter(
                    withFilter(query, 'after', datePresetStart(preset as DatePreset)),
                    'before',
                  ),
                )
                close()
              }
            "
          />
          <div class="mt-3 flex gap-2 border-t border-outline-gray-1 pt-3">
            <FormControl
              type="date"
              size="sm"
              class="w-full min-w-0"
              :label="__('From Date')"
              :model-value="query.after"
              @update:model-value="(value: string) => update(withFilter(query, 'after', value))"
            />
            <FormControl
              type="date"
              size="sm"
              class="w-full min-w-0"
              :label="__('To Date')"
              :model-value="query.before"
              @update:model-value="(value: string) => update(withFilter(query, 'before', value))"
            />
          </div>
        </template>
      </SearchFilterPill>

      <SearchFilterPill
        v-if="!allAccounts"
        :label="__('Folder')"
        :value="folderName"
        :width="'w-56'"
        @clear="update(withFilter(query, 'inMailbox'))"
      >
        <template #default="{ close }">
          <SearchFilterChoices
            :choices="folders"
            :selected="query.inMailbox"
            @pick="
              (id) => {
                update(withFilter(query, 'inMailbox', id))
                close()
              }
            "
          />
        </template>
      </SearchFilterPill>

      <Button
        v-for="toggle in toggles"
        :key="toggle.key"
        size="sm"
        :variant="query[toggle.key] === toggle.value ? 'subtle' : 'outline'"
        class="shrink-0 rounded-4"
        :class="[
          isMobile && '!h-8',
          {
            'border border-transparent !bg-surface-gray-3 hover:!bg-surface-gray-4':
              query[toggle.key] === toggle.value,
          },
        ]"
        :label="toggle.label"
        :aria-pressed="query[toggle.key] === toggle.value"
        @click="update(toggledFilter(query, toggle.key, toggle.value))"
      />
    </template>

    <SearchFilterPill
      v-else
      :label="activeCount ? __('Filters · {0}', [String(activeCount)]) : __('Filters')"
      :width="'w-96'"
    >
      <template #default="{ close }">
        <MailFilterPanel
          v-model:filters="draft"
          v-model:all-accounts="draftAllAccounts"
          :has-multiple-accounts="hasMultipleAccounts"
        />
        <div class="flex justify-end px-4 pb-1 pt-2">
          <Button
            variant="solid"
            :label="__('Apply')"
            @click="
              () => {
                applyPanel()
                close()
              }
            "
          />
        </div>
      </template>
    </SearchFilterPill>

    <!-- Filters with no chip of their own: typed as an operator, or set in the panel. -->
    <SearchFilterChip
      v-for="chip in chips"
      :key="chip.key"
      :label="chip.label"
      :value="chip.label"
      @clear="update(withFilter(query, chip.key))"
    />

    <!-- Where the search looks, always in sight: results silently missing another account were
         the worst of what it could do. Only worth saying with more than one to choose from. -->
    <SearchFilterPill
      v-if="hasMultipleAccounts && tweaks.filters === 'pills'"
      :label="scopeLabel"
      :width="'w-64'"
    >
      <template #default="{ close }">
        <SearchFilterChoices
          :choices="scopes"
          :selected="allAccounts ? 'all' : 'this'"
          @pick="
            (scope) => {
              update(withAllAccounts(query, scope === 'all'))
              close()
            }
          "
        />
      </template>
    </SearchFilterPill>

    <Button
      v-if="activeCount"
      variant="ghost"
      size="sm"
      class="shrink-0"
      :label="__('Clear all')"
      @click="update(withoutFilters(query))"
    />
  </div>
</template>

<script setup lang="ts">
import { Button, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import MailFilterPanel from '@/apps/mail/components/CommandPalette/MailFilterPanel.vue'
import ContactCombobox from '@/apps/mail/components/Controls/ContactCombobox.vue'
import SearchFilterChip from '@/apps/mail/components/SearchFilterChip.vue'
import SearchFilterChoices from '@/apps/mail/components/SearchFilterChoices.vue'
import SearchFilterPill from '@/apps/mail/components/SearchFilterPill.vue'
import { useSearchTweaks } from '@/apps/mail/composables/useSearchTweaks'
import { getAttachmentOptions, getReadStatusOptions } from '@/apps/mail/constants'
import { userStore } from '@/apps/mail/stores/user'
import type { MailboxData } from '@/apps/mail/types'
import { useScreenSize } from '@/apps/mail/utils/composables'
import {
  activeDatePreset,
  datePresetStart,
  toggledFilter,
  withAllAccounts,
  withFilter,
  withoutFilters,
  type DatePreset,
  type SearchQuery,
} from '@/apps/mail/utils/searchFilters'

const { query } = defineProps<{ query: SearchQuery }>()
const emit = defineEmits<{ update: [query: SearchQuery] }>()
const update = (next: SearchQuery) => emit('update', next)

const { isMobile } = useScreenSize()
const { tweaks } = useSearchTweaks()
const store = userStore()

const allAccounts = computed(() => query.all_accounts != null)
const accounts = computed(() => store.userResource.data?.accounts ?? [])
const hasMultipleAccounts = computed(() => accounts.value.length > 1)

const folders = computed(() =>
  (store.mailboxes.data ?? []).map((mailbox: MailboxData) => ({
    label: mailbox._name,
    value: mailbox.id,
  })),
)
const folderName = computed(() =>
  query.inMailbox
    ? (folders.value.find((folder) => folder.value === query.inMailbox)?.label ?? query.inMailbox)
    : undefined,
)

const datePresets = computed(() => [
  { label: __('Past week'), value: 'week' },
  { label: __('Past month'), value: 'month' },
  { label: __('Past 3 months'), value: 'quarter' },
  { label: __('Past year'), value: 'year' },
])
const dateLabel = computed(() => {
  const preset = activeDatePreset(query)
  if (preset) return datePresets.value.find((option) => option.value === preset)?.label
  if (query.after && query.before) return `${query.after} – ${query.before}`
  if (query.after) return __('After {0}', [query.after])
  if (query.before) return __('Before {0}', [query.before])
  return undefined
})

const toggles = computed(() => [
  { key: 'hasAttachment', value: 'true', label: __('Has attachment') },
  { key: 'isRead', value: 'false', label: __('Unread') },
])

// Lower case, as the words read in a sentence — "from: akash@frappe.io" — not as field names.
const OPERATOR_LABELS = {
  subject: __('subject'),
  to: __('to'),
  cc: __('cc'),
  bcc: __('bcc'),
  with: __('with'),
} satisfies Record<string, string>
const optionLabel = (options: { label: string; value: string }[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value

// The chips the row doesn't already answer: every filter under the one button, and otherwise those
// with nowhere else to show, the opposite answers of the two toggles among them.
const chips = computed(() => {
  const all: { key: string; label: string }[] = []
  const menu = tweaks.value.filters === 'menu'
  if (menu && query.from) all.push({ key: 'from', label: `${__('from')}: ${query.from}` })
  if (menu && folderName.value)
    all.push({ key: 'inMailbox', label: `${__('in')}: ${folderName.value}` })
  if (menu && query.after) all.push({ key: 'after', label: `${__('after')}: ${query.after}` })
  if (menu && query.before) all.push({ key: 'before', label: `${__('before')}: ${query.before}` })
  for (const [key, label] of Object.entries(OPERATOR_LABELS))
    if (query[key]) all.push({ key, label: `${label}: ${query[key]}` })
  if (query.hasAttachment && (menu || query.hasAttachment !== 'true'))
    all.push({
      key: 'hasAttachment',
      label: optionLabel(getAttachmentOptions(), query.hasAttachment),
    })
  if (query.isRead && (menu || query.isRead !== 'false'))
    all.push({ key: 'isRead', label: optionLabel(getReadStatusOptions(), query.isRead) })
  return all
})

// Every filter on the search: what's left without its words and its scope.
const panelFields = () => withFilter(withFilter(query, 'text'), 'all_accounts')
const activeCount = computed(() => Object.keys(panelFields()).length)

const thisAccountName = computed(
  () =>
    accounts.value.find((account) => account.id === store.accountId)?._name ?? __('This account'),
)
const scopes = computed(() => [
  { label: thisAccountName.value, value: 'this' },
  { label: __('All accounts'), value: 'all' },
])
const scopeLabel = computed(() => (allAccounts.value ? __('All accounts') : thisAccountName.value))

// The one-button panel edits a copy, for an Apply: a form re-running the search at every keystroke
// would flicker the list behind it.
const draft = ref<SearchQuery>(panelFields())
const draftAllAccounts = ref(allAccounts.value)
watch(
  () => query,
  () => {
    draft.value = panelFields()
    draftAllAccounts.value = allAccounts.value
  },
)
const applyPanel = () => {
  const base: SearchQuery = query.text ? { text: query.text } : {}
  update(withAllAccounts({ ...base, ...draft.value }, draftAllAccounts.value))
}
</script>
