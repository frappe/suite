<template>
  <CommandPalette
    v-model:open="root.paletteOpen"
    v-model:query="query"
    :filterable="false"
    title="Search Suite"
    @keydown.capture="handleModifiedEnter"
    @select="selectItem"
  >
    <CommandPaletteInput
      :placeholder="mailAppliedFilters.length ? 'Add another filter or search mail' : palettePlaceholder"
      @keydown.backspace="removeLastMailFilter"
    >
      <template v-if="mailAppliedFilters.length" #prefix>
        <span class="lucide-search size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
        <MailSearchFilterBadges :filters="mailAppliedFilters" @remove="removeMailFilter" />
      </template>
    </CommandPaletteInput>

    <CommandPaletteList>
      <CommandPaletteGroup v-if="exactApps.length" label="Navigate">
        <CommandPaletteItem
          v-for="app in exactApps"
          :key="app.name"
          :value="app"
        >
          <template #prefix>
            <img :src="app.logo" alt="" class="mr-3 size-4 shrink-0 scale-[1.2] rounded-1" />
          </template>
          {{ app.title }}
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="filteredCommands.length" label="Suggested">
        <CommandPaletteItem
          v-for="command in filteredCommands"
          :key="command.id"
          :value="command"
          :disabled="command.disabled"
        >
          <template #prefix>
            <span
              class="mr-3 flex size-4 shrink-0 items-center justify-center text-ink-gray-7"
            >
              <span :class="command.icon || 'lucide-command'" class="size-4" aria-hidden="true" />
            </span>
          </template>
          {{ command.label }}
          <template v-if="command.description" #suffix>
            <span class="text-ink-gray-5">{{ command.description }}</span>
          </template>
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="driveResults.length" label="Drive">
        <CommandPaletteItem
          v-for="entity in driveResults"
          :key="entity.name"
          :value="entity"
        >
          <template #prefix>
            <DriveSearchResultIcon :entity="entity" />
          </template>
          {{ entity.file_name }}
          <template #suffix>
            <DriveSearchResultModified :modified="entity.modified" />
          </template>
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="sheetResults.length" label="Sheets">
        <CommandPaletteItem
          v-for="sheet in sheetResults"
          :key="sheet.name"
          :value="sheet"
        >
          <template #prefix>
            <DriveSearchResultIcon :entity="sheet" />
          </template>
          {{ sheet.title || 'Untitled Sheet' }}
          <template #suffix>
            <DriveSearchResultModified :modified="sheet.modified" />
          </template>
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="slideResults.length" label="Slides">
        <CommandPaletteItem
          v-for="presentation in slideResults"
          :key="presentation.name"
          :value="presentation"
        >
          <template #prefix>
            <DriveSearchResultIcon :entity="presentation" />
          </template>
          {{ presentation.file_name }}
          <template #suffix>
            <DriveSearchResultModified :modified="presentation.modified" />
          </template>
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="writerResults.length" label="Writer">
        <CommandPaletteItem
          v-for="document in writerResults"
          :key="document.name"
          :value="document"
        >
          <template #prefix>
            <DriveSearchResultIcon :entity="document" />
          </template>
          {{ document.title || 'Untitled Document' }}
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="meetResults.length" label="Meet">
        <CommandPaletteItem
          v-for="meeting in meetResults"
          :key="meeting.name"
          :value="meeting"
        >
          <template #prefix>
            <span class="mr-3 flex size-4 shrink-0 items-center justify-center text-ink-gray-7">
              <span class="lucide-video size-4" aria-hidden="true" />
            </span>
          </template>
          {{ meeting.title || meeting.name }}
          <template #suffix>
            <DriveSearchResultModified :modified="meeting.modified" />
          </template>
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <MailSearchSuggestions :suggestions="mailSuggestions" />

      <CommandPaletteGroup v-if="mailResults.length" label="Mail">
        <CommandPaletteItem
          v-for="mail in mailResults"
          :key="`${mail.account}-${mail.thread_id}`"
          :value="mail"
        >
          <template #prefix>
            <span class="mr-3 flex size-4 shrink-0 items-center justify-center text-ink-gray-7">
              <span class="lucide-mail size-4" aria-hidden="true" />
            </span>
          </template>
          {{ mail.subject || '[No subject]' }}
          <template #suffix>
            <span class="max-w-48 truncate text-ink-gray-5">{{ mail.from_name || mail.from_email }}</span>
          </template>
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="remainingApps.length" label="Navigate">
        <CommandPaletteItem
          v-for="app in remainingApps"
          :key="app.name"
          :value="app"
        >
          <template #prefix>
            <img :src="app.logo" alt="" class="mr-3 size-4 shrink-0 scale-[1.2] rounded-1" />
          </template>
          {{ app.title }}
        </CommandPaletteItem>
      </CommandPaletteGroup>
    </CommandPaletteList>

    <CommandPaletteEmpty v-slot="{ query: text }">
      {{ mailOperatorContext?.prompt || (mailAppliedFilters.length ? 'No mail matches these filters' : text && text.length < minimumQueryLength && contextSearchLabel ? `Type more to search ${contextSearchLabel}` : `No results for "${text}"`) }}
    </CommandPaletteEmpty>

    <CommandPaletteFooter>
      <span v-if="!navigationMode" class="flex items-center gap-1.5">
        <span class="inline-flex items-center gap-0.5 rounded-1 bg-surface-gray-2 px-1 py-0.5 text-sm text-ink-gray-5">&gt;</span>
        <span>Switch apps</span>
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-flex items-center gap-0.5 rounded-1 bg-surface-gray-2 p-0.5 text-sm text-ink-gray-5">
          <span class="lucide-arrow-up size-4" />
        </span>
        <span class="inline-flex items-center gap-0.5 rounded-1 bg-surface-gray-2 p-0.5 text-sm text-ink-gray-5">
          <span class="lucide-arrow-down size-4" />
        </span>
        <span>Navigate</span>
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-flex items-center gap-0.5 rounded-1 bg-surface-gray-2 p-0.5 text-sm text-ink-gray-5">
          <span class="lucide-corner-down-left size-4" />
        </span>
        <span>Open</span>
      </span>
      <span class="ml-auto flex items-center gap-1.5">
        <span class="inline-flex items-center gap-0.5 rounded-1 bg-surface-gray-2 px-1 py-0.5 text-sm text-ink-gray-5">esc</span>
        <span>Close</span>
      </span>
    </CommandPaletteFooter>
  </CommandPalette>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import { createResource, useKeyboardShortcut } from 'frappe-ui'
import {
  CommandPalette,
  CommandPaletteEmpty,
  CommandPaletteFooter,
  CommandPaletteGroup,
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  type CommandPaletteSelectEvent,
} from 'frappe-ui/experimental'
import { getAppSwitcherItems, type SuiteAppSwitcherItem } from '@/apps/registry'
import { getMailChoiceOperator, getMailContactOperator, getMailSearchOperatorContext, parseMailSearchQuery } from '@/apps/mail/utils/searchQuery'
import { userStore } from '@/apps/mail/stores/user'
import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { getIcon } from '@/apps/mail/utils'
import { utcDayEnd, utcDayStart } from '@/apps/mail/utils/datetime'
import MailSearchFilterBadges from '@/apps/mail/components/CommandPalette/MailSearchFilterBadges.vue'
import MailSearchSuggestions from '@/apps/mail/components/CommandPalette/MailSearchSuggestions.vue'
import type {
  MailContactSuggestion,
  MailFilterSuggestion,
  MailSearchFilterBadge,
} from '@/apps/mail/components/CommandPalette/types'
import { useRootStore, type PaletteCommand } from '@/stores/root'

interface DriveResult {
  name: string
  file_name: string
  file_type?: string
  is_folder: boolean
  modified?: string
  user_name?: string
  full_name?: string
  [key: string]: unknown
}

interface SheetResult {
  resultType: 'sheet'
  name: string
  title?: string
  modified?: string
  content_doctype: 'Sheet'
  file_type: 'Spreadsheet'
  [key: string]: unknown
}

interface SlideResult {
  resultType: 'slide'
  name: string
  file_name: string
  content_docname: string
  modified?: string
  thumbnail?: string
  owner?: string
  content_doctype: 'Presentation'
  [key: string]: unknown
}

interface WriterResult {
  resultType: 'writer'
  name: string
  title?: string
  content_doctype: 'Writer Document'
  file_type: 'Document'
  [key: string]: unknown
}

interface MeetResult {
  resultType: 'meeting'
  name: string
  title?: string
  modified?: string
}

interface MailResult {
  resultType: 'mail'
  account: string
  thread_id: string
  subject?: string
  from_name?: string
  from_email: string
}

const minimumQueryLength = 3
const DriveSearchResultIcon = defineAsyncComponent(
  () => import('@/apps/drive/components/DriveSearchResultIcon.vue'),
)
const DriveSearchResultModified = defineAsyncComponent(
  () => import('@/apps/drive/components/DriveSearchResultModified.vue'),
)
const root = useRootStore()
const mailUser = userStore()
const route = useRoute()
const router = useRouter()
const query = ref('')
const navigationMode = ref(false)
const mailAppliedFilters = ref<MailSearchFilterBadge[]>([])
let openSelectionInNewTab = false

useKeyboardShortcut({
  combo: 'Mod+K',
  description: 'Search Suite',
  group: 'Suite',
  allowInInput: true,
  handler: () => {
    root.paletteOpen = true
  },
})

const driveSearch = createResource({
  auto: false,
  method: 'POST',
  url: 'suite.drive.api.files.search',
  debounce: 180,
})
const sheetSearch = createResource({
  auto: false,
  method: 'POST',
  url: 'suite.sheets.api.list_sheets',
  debounce: 180,
})
const slideSearch = createResource({
  auto: false,
  method: 'GET',
  url: 'suite.drive.api.list.files',
  debounce: 180,
})
const writerSearch = createResource({
  auto: false,
  method: 'GET',
  url: 'suite.writer.api.general.search',
  debounce: 180,
})
const meetSearch = createResource({
  auto: false,
  method: 'POST',
  url: 'frappe.client.get_list',
  debounce: 180,
})
const mailSearch = createResource({
  auto: false,
  method: 'POST',
  url: 'suite.mail.api.mail.search_mails',
  debounce: 180,
})
const mailContactSearch = createResource({
  auto: false,
  method: 'GET',
  url: 'suite.mail.api.mail.get_email_suggestions',
  debounce: 180,
})

const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const appQuery = computed(() => normalizedQuery.value)
const mailFilter = computed(() => ({
  ...Object.fromEntries(mailAppliedFilters.value.map(({ key, value }) => [key, value])),
  ...parseMailSearchQuery(query.value.trim()),
}))
const mailRequestFilter = computed(() => ({
  ...mailFilter.value,
  ...(mailFilter.value.after ? { after: utcDayStart(mailFilter.value.after) } : {}),
  ...(mailFilter.value.before ? { before: utcDayEnd(mailFilter.value.before) } : {}),
}))
const mailOperatorContext = computed(() =>
  activeApp.value === 'mail' ? getMailSearchOperatorContext(query.value) : null,
)
const activeMailContactOperator = computed(() =>
  activeApp.value === 'mail' ? getMailContactOperator(query.value) : null,
)
const activeMailChoiceOperator = computed(() =>
  activeApp.value === 'mail' ? getMailChoiceOperator(query.value) : null,
)
const driveResults = computed<DriveResult[]>(() =>
  activeApp.value === 'drive' && Array.isArray(driveSearch.data)
    ? driveSearch.data.slice(0, 20)
    : [],
)
const sheetResults = computed<SheetResult[]>(() => {
  if (activeApp.value !== 'sheets' || !Array.isArray(sheetSearch.data?.sheets)) return []
  return sheetSearch.data.sheets.slice(0, 20).map((sheet: Omit<SheetResult, 'resultType'>) => ({
    ...sheet,
    resultType: 'sheet' as const,
    content_doctype: 'Sheet' as const,
    file_type: 'Spreadsheet' as const,
  }))
})
const slideResults = computed<SlideResult[]>(() => {
  if (activeApp.value !== 'slides' || !Array.isArray(slideSearch.data?.rows)) return []
  return slideSearch.data.rows
    .filter((row: SlideResult) => row.content_docname)
    .slice(0, 20)
    .map((row: Omit<SlideResult, 'resultType'>) => ({ ...row, resultType: 'slide' as const }))
})
const writerResults = computed<WriterResult[]>(() => {
  if (activeApp.value !== 'writer' || !Array.isArray(writerSearch.data?.results)) return []
  return writerSearch.data.results.slice(0, 20).map((document: Omit<WriterResult, 'resultType'>) => ({
    ...document,
    resultType: 'writer' as const,
    content_doctype: 'Writer Document' as const,
    file_type: 'Document' as const,
  }))
})
const meetResults = computed<MeetResult[]>(() => {
  if (activeApp.value !== 'meet' || !Array.isArray(meetSearch.data)) return []
  return meetSearch.data.slice(0, 20).map((meeting: Omit<MeetResult, 'resultType'>) => ({
    ...meeting,
    resultType: 'meeting' as const,
  }))
})
const mailResults = computed<MailResult[]>(() => {
  if (activeApp.value !== 'mail' || !Array.isArray(mailSearch.data?.[0])) return []
  return mailSearch.data[0].slice(0, 20).map((mail: Omit<MailResult, 'resultType'>) => ({
    ...mail,
    resultType: 'mail' as const,
  }))
})
const mailContactResults = computed<MailContactSuggestion[]>(() => {
  if (!activeMailContactOperator.value?.partial || !Array.isArray(mailContactSearch.data)) return []
  const partial = activeMailContactOperator.value.partial
  const contacts = mailContactSearch.data.map((contact: { email: string; name?: string; user_image?: string }) => ({
    ...contact,
    value: contact.email,
    label: contact.name || contact.email,
    resultType: 'mail-contact' as const,
  }))
  if (!contacts.some((contact: MailContactSuggestion) => contact.email.toLowerCase() === partial.toLowerCase())) {
    contacts.push({ resultType: 'mail-contact', value: partial, label: partial, email: partial })
  }
  return contacts.slice(0, 3)
})
const mailFilterSuggestions = computed<MailFilterSuggestion[]>(() => {
  const operator = activeMailChoiceOperator.value
  if (!operator) return []
  const partial = operator.partial.toLowerCase()
  if (operator.key === 'in') {
    return (mailUser.mailboxes.data ?? [])
      .filter((mailbox: { _name: string }) => mailbox._name.toLowerCase().includes(partial))
      .slice(0, 3)
      .map((mailbox: { id: string; _name: string; role?: string; icon?: string; color?: keyof typeof FOLDER_ICON_COLOR_MAP }) => ({
        resultType: 'mail-filter-suggestion' as const,
        value: mailbox.id,
        label: mailbox._name,
        filterKey: 'inMailbox',
        filterValue: mailbox.id,
        icon: getIcon(mailbox).startsWith('lucide-') ? getIcon(mailbox) : `lucide-${getIcon(mailbox)}`,
        iconClass: mailbox.color ? FOLDER_ICON_COLOR_MAP[mailbox.color] : undefined,
      }))
  }
  const choices = operator.key === 'has'
    ? [
        { value: 'attachment', label: 'With attachments', filterKey: 'hasAttachment', filterValue: 'true', icon: 'lucide-paperclip' },
        { value: 'no-attachment', label: 'Without attachments', filterKey: 'hasAttachment', filterValue: 'false', icon: 'lucide-ban' },
      ]
    : [
        { value: 'read', label: 'Read', filterKey: 'isRead', filterValue: 'true', icon: 'lucide-mail-open' },
        { value: 'unread', label: 'Unread', filterKey: 'isRead', filterValue: 'false', icon: 'lucide-mail' },
      ]
  return choices
    .filter((choice) => choice.value.includes(partial) || choice.label.toLowerCase().includes(partial))
    .map((choice) => ({ resultType: 'mail-filter-suggestion' as const, ...choice }))
})
const mailSuggestions = computed(() => [...mailContactResults.value, ...mailFilterSuggestions.value])
const activeApp = computed(() => String(route.meta.appId ?? ''))
const contextSearchLabel = computed(() =>
  ({ drive: 'Drive', sheets: 'Sheets', slides: 'Slides', writer: 'Writer', meet: 'Meet', mail: 'Mail', calendar: 'Calendar' })[activeApp.value],
)
const palettePlaceholder = computed(() =>
  navigationMode.value ? 'Switch apps' : `Search in ${contextSearchLabel.value || 'Suite'}`,
)
const apps = computed(() => getAppSwitcherItems(String(route.meta.appId ?? '')))
const filteredApps = computed(() => {
  if (activeApp.value === 'mail' && mailAppliedFilters.value.length) return []
  if (!appQuery.value) return apps.value
  return apps.value.filter((app) =>
    `${app.title} ${app.name}`.toLowerCase().includes(appQuery.value),
  )
})
const exactApps = computed(() =>
  appQuery.value
    ? filteredApps.value.filter(
        (app) =>
          app.title.toLowerCase() === appQuery.value ||
          app.name.toLowerCase() === appQuery.value,
      )
    : [],
)
const remainingApps = computed(() =>
  filteredApps.value.filter((app) => !exactApps.value.includes(app)),
)
const filteredCommands = computed(() => {
  if (navigationMode.value || (activeApp.value === 'mail' && mailAppliedFilters.value.length)) return []
  const commands = root.paletteGroups.flatMap((group) => group.commands)
  if (!normalizedQuery.value) return commands
  return commands.filter((command) =>
    [command.label, command.description, ...(command.keywords ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery.value),
  )
})

watch([query, mailAppliedFilters], ([value]) => {
  if (!navigationMode.value && value.trim() === '>') {
    navigationMode.value = true
    query.value = ''
    resetSearches()
    return
  }

  const text = value.trim()
  cancelSearches()
  if (navigationMode.value) return

  if (activeApp.value === 'mail') {
    if (consumeMailFilterToken(value)) return
    const account = String(route.params.accountId || localStorage.getItem('mail-account-id') || '')
    if (account && activeMailContactOperator.value?.partial) {
      mailContactSearch.submit({
        account,
        text: activeMailContactOperator.value.partial,
        limit: 5,
      })
    }
    if (account && (text.length >= minimumQueryLength || mailAppliedFilters.value.length)) {
      mailSearch.submit({ account, filter: mailRequestFilter.value, limit: 20 })
    } else if (!mailAppliedFilters.value.length) {
      resetSearches()
    }
    return
  }

  if (text.length < minimumQueryLength) {
    resetSearches()
    return
  }

  if (activeApp.value === 'drive') {
    driveSearch.submit({ query: text })
  } else if (activeApp.value === 'sheets') {
    sheetSearch.submit({
      start: 0,
      limit: 20,
      search: text,
      owner_filter: 'all',
      order_by: 'modified',
      sort_dir: 'desc',
    })
  } else if (activeApp.value === 'slides') {
    slideSearch.submit({
      search: text,
      file_kinds: JSON.stringify(['Presentation']),
      order_by: 'modified',
      ascending: false,
      start: 0,
      limit: 20,
      paginated: true,
    })
  } else if (activeApp.value === 'writer') {
    writerSearch.submit({ query: text })
  } else if (activeApp.value === 'meet') {
    meetSearch.submit({
      doctype: 'Meet Room',
      fields: ['name', 'title', 'modified'],
      or_filters: [
        ['Meet Room', 'title', 'like', `%${text}%`],
        ['Meet Room', 'name', 'like', `%${text}%`],
      ],
      order_by: 'modified desc',
      limit_page_length: 20,
    })
  }
}, { deep: true })

watch(
  () => root.paletteOpen,
  (open) => {
    if (open) return
    navigationMode.value = false
    mailAppliedFilters.value = []
    resetSearches()
  },
)

function resetSearches() {
  cancelSearches()
  for (const resource of [driveSearch, sheetSearch, slideSearch, writerSearch, meetSearch, mailSearch, mailContactSearch]) {
    resource.reset()
  }
}

function cancelSearches() {
  for (const resource of [driveSearch, sheetSearch, slideSearch, writerSearch, meetSearch, mailSearch, mailContactSearch]) {
    resource.submit.cancel()
    resource.abort()
  }
}

function consumeMailFilterToken(value: string) {
  const match = value.match(/(?:^|\s)(from|to|cc|bcc|subject|after|before|has|is):(?:"[^"]+"|\S+)\s$/i)
  if (!match || match.index == null) return false
  const parsed = parseMailSearchQuery(match[0].trim())
  const entry = Object.entries(parsed).find(([key]) => key !== 'text')
  if (!entry) return false
  const [key, filterValue] = entry
  applyMailFilter(key, filterValue)
  query.value = value.slice(0, match.index).trim()
  return true
}

function applyMailFilter(key: string, value: string, displayValue = value) {
  mailAppliedFilters.value = [
    ...mailAppliedFilters.value.filter((filter) => filter.key !== key),
    { key, value, displayValue },
  ]
}

function selectMailContact(contact: MailContactSuggestion) {
  const operator = activeMailContactOperator.value
  if (!operator) return
  applyMailFilter(operator.key, contact.email)
  query.value = query.value.replace(
    new RegExp(`(?:^|\\s)${operator.key}:[^\\s]*$`, 'i'),
    '',
  ).trim()
}

function selectMailFilterSuggestion(suggestion: MailFilterSuggestion) {
  const operator = activeMailChoiceOperator.value
  if (!operator) return
  applyMailFilter(suggestion.filterKey, suggestion.filterValue, suggestion.label)
  query.value = query.value.replace(
    new RegExp(`(?:^|\\s)${operator.key}:[^\\s]*$`, 'i'),
    '',
  ).trim()
}

function removeMailFilter(key: string) {
  mailAppliedFilters.value = mailAppliedFilters.value.filter((filter) => filter.key !== key)
}

function removeLastMailFilter(event: KeyboardEvent) {
  if (query.value || !mailAppliedFilters.value.length) return
  event.preventDefault()
  mailAppliedFilters.value = mailAppliedFilters.value.slice(0, -1)
}

function handleModifiedEnter(event: KeyboardEvent) {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
  const activeItem = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
    '[data-slot="command-palette-item"][data-state="active"]',
  )
  if (!activeItem) return
  event.preventDefault()
  event.stopPropagation()
  openSelectionInNewTab = true
  activeItem.click()
}

async function selectItem(
  item: DriveResult | SheetResult | SlideResult | WriterResult | MeetResult | MailResult | MailContactSuggestion | MailFilterSuggestion | PaletteCommand | SuiteAppSwitcherItem,
  event: CommandPaletteSelectEvent,
) {
  const originalEvent = event.detail.originalEvent
  const openInNewTab = openSelectionInNewTab || originalEvent.metaKey || originalEvent.ctrlKey
  openSelectionInNewTab = false
  if ('resultType' in item && item.resultType === 'mail-contact') {
    event.preventDefault()
    selectMailContact(item)
    return
  }
  if ('resultType' in item && item.resultType === 'mail-filter-suggestion') {
    event.preventDefault()
    selectMailFilterSuggestion(item)
    return
  }
  if ('run' in item) {
    await item.run()
    return
  }
  if ('route' in item) {
    if (openInNewTab) {
      window.open(item.route, '_blank', 'noopener')
      return
    }
    if (!item.spa) {
      window.location.assign(item.route)
      return
    }
    await router.push(item.route)
    return
  }
  if ('resultType' in item) {
    let location: RouteLocationRaw
    if (item.resultType === 'sheet') {
      location = { name: 'sheets-editor', params: { id: item.name } }
    } else if (item.resultType === 'slide') {
      location = {
        name: 'slides-editor',
        params: { presentationId: item.content_docname },
        query: { slide: 1 },
      }
    } else if (item.resultType === 'writer') {
      location = { name: 'writer-document', params: { id: item.name } }
    } else if (item.resultType === 'mail') {
      location = {
        name: 'mail-mail',
        params: { accountId: item.account, mailbox: 'search', threadID: item.thread_id },
        query: mailFilter.value,
      }
    } else {
      location = { name: 'meet-meeting', params: { meetingId: item.name } }
    }
    if (openInNewTab) {
      window.open(router.resolve(location).href, '_blank', 'noopener')
    } else {
      await router.push(location)
    }
    return
  }

  const { openEntity } = await import('@/apps/drive/utils/files')
  openEntity(item, openInNewTab)
}

onScopeDispose(() => {
  resetSearches()
})
</script>
