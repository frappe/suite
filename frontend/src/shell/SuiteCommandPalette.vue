<template>
  <CommandPalette
    v-model:open="root.paletteOpen"
    v-model:query="query"
    :filterable="false"
    title="Search Suite"
    @select="selectItem"
  >
    <CommandPaletteInput :placeholder="palettePlaceholder" />

    <CommandPaletteList>
      <CommandPaletteGroup v-if="exactApps.length" label="Navigate">
        <CommandPaletteItem
          v-for="app in exactApps"
          :key="app.name"
          :value="app"
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
        >
          <template #prefix>
            <img :src="app.logo" alt="" class="mr-2 size-7 shrink-0 rounded-2" />
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
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
        >
          <template #prefix>
            <span
              class="mr-2 flex size-7 shrink-0 items-center justify-center rounded-4 bg-surface-gray-2 text-ink-gray-7"
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
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
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
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
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
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
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
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
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
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
        >
          <template #prefix>
            <span class="mr-2 flex size-7 shrink-0 items-center justify-center rounded-4 bg-surface-gray-2 text-ink-gray-7">
              <span class="lucide-video size-4" aria-hidden="true" />
            </span>
          </template>
          {{ meeting.title || meeting.name }}
          <template #suffix>
            <DriveSearchResultModified :modified="meeting.modified" />
          </template>
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="mailResults.length" label="Mail">
        <CommandPaletteItem
          v-for="mail in mailResults"
          :key="`${mail.account}-${mail.thread_id}`"
          :value="mail"
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
        >
          <template #prefix>
            <span class="mr-2 flex size-7 shrink-0 items-center justify-center rounded-4 bg-surface-gray-2 text-ink-gray-7">
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
          class="!py-1.5 !text-sm data-[state=active]:!bg-surface-gray-2"
        >
          <template #prefix>
            <img :src="app.logo" alt="" class="mr-2 size-7 shrink-0 rounded-2" />
          </template>
          {{ app.title }}
        </CommandPaletteItem>
      </CommandPaletteGroup>
    </CommandPaletteList>

    <CommandPaletteEmpty v-slot="{ query: text }">
      {{ text && text.length < minimumQueryLength && contextSearchLabel ? `Type more to search ${contextSearchLabel}` : `No results for "${text}"` }}
    </CommandPaletteEmpty>

    <CommandPaletteFooter>
      <span v-if="!navigationMode" class="flex items-center gap-1.5">
        <kbd class="inline-flex h-6 min-w-6 items-center justify-center rounded-4 bg-surface-gray-2 px-1.5 text-xs-medium text-ink-gray-7">&gt;</kbd>
        <span>Switch apps</span>
      </span>
      <span class="flex items-center gap-1.5">
        <KeyboardShortcut combo="ArrowUp" bg />
        <KeyboardShortcut combo="ArrowDown" bg />
        <span>Navigate</span>
      </span>
      <span class="flex items-center gap-1.5">
        <KeyboardShortcut combo="Enter" bg />
        <span>Open</span>
      </span>
      <span class="ml-auto flex items-center gap-1.5">
        <KeyboardShortcut combo="Escape" bg />
        <span>Close</span>
      </span>
    </CommandPaletteFooter>
  </CommandPalette>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import { createResource, KeyboardShortcut, useKeyboardShortcut } from 'frappe-ui'
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
import { parseMailSearchQuery } from '@/apps/mail/utils/searchQuery'
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
const route = useRoute()
const router = useRouter()
const query = ref('')
const navigationMode = ref(false)

useKeyboardShortcut({
  combo: 'Mod+K',
  description: 'Search Suite',
  group: 'Suite',
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

const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const appQuery = computed(() => normalizedQuery.value)
const mailFilter = computed(() => parseMailSearchQuery(query.value.trim()))
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
const activeApp = computed(() => String(route.meta.appId ?? ''))
const contextSearchLabel = computed(() =>
  ({ drive: 'Drive', sheets: 'Sheets', slides: 'Slides', writer: 'Writer', meet: 'Meet', mail: 'Mail', calendar: 'Calendar' })[activeApp.value],
)
const palettePlaceholder = computed(() =>
  navigationMode.value ? 'Switch apps' : `Search in ${contextSearchLabel.value || 'Suite'}`,
)
const apps = computed(() => getAppSwitcherItems(String(route.meta.appId ?? '')))
const filteredApps = computed(() => {
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
  if (navigationMode.value) return []
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

watch(query, (value) => {
  if (!navigationMode.value && value.trim() === '>') {
    navigationMode.value = true
    query.value = ''
    resetSearches()
    return
  }

  const text = value.trim()
  resetSearches()
  if (navigationMode.value) return
  if (text.length < minimumQueryLength) return

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
  } else if (activeApp.value === 'mail') {
    const account = String(route.params.accountId || localStorage.getItem('mail-account-id') || '')
    if (account) mailSearch.submit({ account, filter: mailFilter.value, limit: 20 })
  }
})

watch(
  () => root.paletteOpen,
  (open) => {
    if (open) return
    navigationMode.value = false
    resetSearches()
  },
)

function resetSearches() {
  for (const resource of [driveSearch, sheetSearch, slideSearch, writerSearch, meetSearch, mailSearch]) {
    resource.submit.cancel()
    resource.abort()
    resource.reset()
  }
}

async function selectItem(
  item: DriveResult | SheetResult | SlideResult | WriterResult | MeetResult | MailResult | PaletteCommand | SuiteAppSwitcherItem,
  event: CommandPaletteSelectEvent,
) {
  if ('run' in item) {
    await item.run()
    return
  }
  const originalEvent = event.detail.originalEvent
  const openInNewTab = originalEvent.metaKey || originalEvent.ctrlKey
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
