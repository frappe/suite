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
      ref="paletteInput"
      :placeholder="
        mailAppliedFilters.length
          ? 'Add another filter or search mail'
          : palettePlaceholder
      "
      @keydown.backspace="removeLastMailFilter"
    >
      <template v-if="activeApp === 'mail'" #suffix>
        <Button
          variant="ghost"
          icon="lucide-sliders-horizontal"
          size="sm"
          aria-label="Advanced search in Mail"
          @mousedown.prevent
          @click="openMailAdvancedSearch"
        />
      </template>
    </CommandPaletteInput>

    <div
      v-if="activeApp === 'mail'"
      class="relative flex shrink-0 flex-wrap items-center gap-1.5 px-4 py-2"
      :class="{ 'pr-12': mailAppliedFilters.length }"
    >
      <span
        v-for="filter in mailAppliedFilters"
        :key="filter.key"
        class="inline-flex h-7 items-center gap-1 rounded-4 bg-surface-gray-2 pl-2 pr-1 text-xs"
      >
        <span class="max-w-40 truncate">{{ getMailFilterLabel(filter) }}</span>
        <button
          class="rounded-4 p-1 text-ink-gray-5 hover:text-ink-gray-8"
          aria-label="Remove filter"
          @mousedown.prevent
          @click.stop="removeMailFilter(filter.key)"
        >
          <span class="lucide-x size-3" aria-hidden="true" />
        </button>
      </span>
      <Button
        v-for="option in availableMailFilterOptions"
        :key="option.key"
        variant="outline"
        size="sm"
        class="!h-7 text-xs"
        @mousedown.prevent
        @click="applyMailQuickFilter(option)"
      >
        <span class="flex items-center gap-1">
          <span class="lucide-plus size-3" aria-hidden="true" />
          {{ option.label }}
        </span>
      </Button>
      <Button
        v-if="mailAppliedFilters.length"
        variant="ghost"
        icon="lucide-x"
        size="sm"
        class="absolute right-4 top-2 !size-7 !p-0"
        aria-label="Clear all filters"
        @mousedown.prevent
        @click="mailAppliedFilters = []"
      />
    </div>

    <CommandPaletteList>
      <CommandPaletteGroup
        v-if="navigationMode && exactApps.length"
        label="Navigate"
      >
        <CommandPaletteItem
          v-for="app in exactApps"
          :key="app.name"
          :value="app"
        >
          <template #prefix>
            <img
              :src="app.logo"
              alt=""
              class="mr-3 size-4 shrink-0 scale-[1.2] rounded-1"
            />
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
              <span
                :class="command.icon || 'lucide-command'"
                class="size-4"
                aria-hidden="true"
              />
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
          {{ sheet.title || "Untitled Sheet" }}
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
          {{ document.title || "Untitled Document" }}
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup v-if="meetResults.length" label="Meet">
        <CommandPaletteItem
          v-for="meeting in meetResults"
          :key="meeting.name"
          :value="meeting"
        >
          <template #prefix>
            <span
              class="mr-3 flex size-4 shrink-0 items-center justify-center text-ink-gray-7"
            >
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

      <CommandPaletteGroup v-if="mailResults.length">
        <CommandPaletteItem
          v-for="mail in mailResults"
          :key="`${mail.account}-${mail.thread_id}`"
          :value="mail"
          class="group [&_[data-slot=command-palette-item-label]]:flex-1"
        >
          <MailSearchResult :result="mail" />
        </CommandPaletteItem>
      </CommandPaletteGroup>

      <CommandPaletteGroup
        v-if="navigationMode && remainingApps.length"
        label="Navigate"
      >
        <CommandPaletteItem
          v-for="app in remainingApps"
          :key="app.name"
          :value="app"
        >
          <template #prefix>
            <img
              :src="app.logo"
              alt=""
              class="mr-3 size-4 shrink-0 scale-[1.2] rounded-1"
            />
          </template>
          {{ app.title }}
        </CommandPaletteItem>
      </CommandPaletteGroup>
    </CommandPaletteList>

    <CommandPaletteEmpty
      v-if="normalizedQuery || mailAppliedFilters.length"
      v-slot="{ query: text }"
    >
      {{
        mailOperatorContext?.prompt ||
        (mailAppliedFilters.length
          ? "No mail matches these filters"
          : activeApp !== "mail" &&
              text &&
              text.length < minimumQueryLength &&
              contextSearchLabel
            ? `Type more to search ${contextSearchLabel}`
            : `No results for "${text}"`)
      }}
    </CommandPaletteEmpty>

    <CommandPaletteFooter class="!justify-between !px-2.5 !text-xs">
      <span class="flex items-center gap-4">
        <span class="flex items-center gap-1">
          <span
            class="inline-flex items-center rounded-1 bg-surface-gray-2 p-0.5 text-ink-gray-5"
          >
            <span class="lucide-arrow-down size-4" />
          </span>
          <span
            class="inline-flex items-center rounded-1 bg-surface-gray-2 p-0.5 text-ink-gray-5"
          >
            <span class="lucide-arrow-up size-4" />
          </span>
          <span>to navigate</span>
        </span>
        <span class="flex items-center gap-1">
          <span
            class="inline-flex items-center rounded-1 bg-surface-gray-2 p-0.5 text-ink-gray-5"
          >
            <span class="lucide-corner-down-left size-4" />
          </span>
          <span>to open</span>
        </span>
        <span class="flex items-center gap-1">
          <span
            class="inline-flex items-center rounded-1 bg-surface-gray-2 px-1 py-0.5 text-[11px] text-ink-gray-5"
            >esc</span
          >
          <span>to close</span>
        </span>
      </span>
      <span v-if="!navigationMode" class="flex items-center gap-1">
        <span
          class="inline-flex items-center rounded-1 bg-surface-gray-2 px-1 py-0.5 text-[11px] text-ink-gray-5"
          >&gt;</span
        >
        <span>to switch apps</span>
      </span>
    </CommandPaletteFooter>
  </CommandPalette>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onScopeDispose,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import type { RouteLocationRaw } from "vue-router";
import { Button, createResource, useKeyboardShortcut } from "frappe-ui";
import {
  CommandPalette,
  CommandPaletteEmpty,
  CommandPaletteFooter,
  CommandPaletteGroup,
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  type CommandPaletteSelectEvent,
} from "frappe-ui/experimental";
import {
  getAppSwitcherItems,
  type SuiteAppSwitcherItem,
} from "@/apps/registry";
import {
  mailFilterOptions,
  useMailCommandPaletteSearch,
} from "@/apps/mail/composables/useMailCommandPaletteSearch";
import MailSearchResult from "@/apps/mail/components/CommandPalette/MailSearchResult.vue";
import MailSearchSuggestions from "@/apps/mail/components/CommandPalette/MailSearchSuggestions.vue";
import type {
  MailContactSuggestion,
  MailFilterSuggestion,
  MailSearchResult as MailResult,
} from "@/apps/mail/components/CommandPalette/types";
import { useRootStore, type PaletteCommand } from "@/stores/root";

interface DriveResult {
  name: string;
  file_name: string;
  file_type?: string;
  is_folder: boolean;
  modified?: string;
  user_name?: string;
  full_name?: string;
  [key: string]: unknown;
}

interface SheetResult {
  resultType: "sheet";
  name: string;
  title?: string;
  modified?: string;
  content_doctype: "Sheet";
  file_type: "Spreadsheet";
  [key: string]: unknown;
}

interface SlideResult {
  resultType: "slide";
  name: string;
  file_name: string;
  content_docname: string;
  modified?: string;
  thumbnail?: string;
  owner?: string;
  content_doctype: "Presentation";
  [key: string]: unknown;
}

interface WriterResult {
  resultType: "writer";
  name: string;
  title?: string;
  content_doctype: "Writer Document";
  file_type: "Document";
  [key: string]: unknown;
}

interface MeetResult {
  resultType: "meeting";
  name: string;
  title?: string;
  modified?: string;
}

const minimumQueryLength = 3;
const DriveSearchResultIcon = defineAsyncComponent(
  () => import("@/apps/drive/components/DriveSearchResultIcon.vue"),
);
const DriveSearchResultModified = defineAsyncComponent(
  () => import("@/apps/drive/components/DriveSearchResultModified.vue"),
);
const root = useRootStore();
const route = useRoute();
const router = useRouter();
const paletteInput = ref<{ $el: HTMLElement } | null>(null);
const query = ref("");
const navigationMode = ref(false);
const activeApp = computed(() => String(route.meta.appId ?? ""));
const mailSearchActive = computed(() => activeApp.value === "mail");
const {
  appliedFilters: mailAppliedFilters,
  availableFilterOptions: availableMailFilterOptions,
  filter: mailFilter,
  operatorContext: mailOperatorContext,
  results: mailResults,
  suggestions: mailSuggestions,
  applyFilter: applyMailFilter,
  getFilterLabel: getMailFilterLabel,
  selectContact: selectMailContact,
  selectFilterSuggestion: selectMailFilterSuggestion,
  search: searchMail,
  cancel: cancelMailSearch,
  reset: resetMailSearch,
} = useMailCommandPaletteSearch(query, mailSearchActive);
let openSelectionInNewTab = false;

useKeyboardShortcut({
  combo: "Mod+K",
  description: "Search Suite",
  group: "Suite",
  allowInInput: true,
  handler: () => {
    root.paletteOpen = true;
  },
});

const driveSearch = createResource({
  auto: false,
  method: "POST",
  url: "suite.drive.api.files.search",
  debounce: 180,
});
const sheetSearch = createResource({
  auto: false,
  method: "POST",
  url: "suite.sheets.api.list_sheets",
  debounce: 180,
});
const slideSearch = createResource({
  auto: false,
  method: "GET",
  url: "suite.drive.api.list.files",
  debounce: 180,
});
const writerSearch = createResource({
  auto: false,
  method: "GET",
  url: "suite.writer.api.general.search",
  debounce: 180,
});
const meetSearch = createResource({
  auto: false,
  method: "POST",
  url: "frappe.client.get_list",
  debounce: 180,
});
const normalizedQuery = computed(() => query.value.trim().toLowerCase());
const appQuery = computed(() => normalizedQuery.value);
const driveResults = computed<DriveResult[]>(() =>
  activeApp.value === "drive" && Array.isArray(driveSearch.data)
    ? driveSearch.data.slice(0, 20)
    : [],
);
const sheetResults = computed<SheetResult[]>(() => {
  if (activeApp.value !== "sheets" || !Array.isArray(sheetSearch.data?.sheets))
    return [];
  return sheetSearch.data.sheets
    .slice(0, 20)
    .map((sheet: Omit<SheetResult, "resultType">) => ({
      ...sheet,
      resultType: "sheet" as const,
      content_doctype: "Sheet" as const,
      file_type: "Spreadsheet" as const,
    }));
});
const slideResults = computed<SlideResult[]>(() => {
  if (activeApp.value !== "slides" || !Array.isArray(slideSearch.data?.rows))
    return [];
  return slideSearch.data.rows
    .filter((row: SlideResult) => row.content_docname)
    .slice(0, 20)
    .map((row: Omit<SlideResult, "resultType">) => ({
      ...row,
      resultType: "slide" as const,
    }));
});
const writerResults = computed<WriterResult[]>(() => {
  if (
    activeApp.value !== "writer" ||
    !Array.isArray(writerSearch.data?.results)
  )
    return [];
  return writerSearch.data.results
    .slice(0, 20)
    .map((document: Omit<WriterResult, "resultType">) => ({
      ...document,
      resultType: "writer" as const,
      content_doctype: "Writer Document" as const,
      file_type: "Document" as const,
    }));
});
const meetResults = computed<MeetResult[]>(() => {
  if (activeApp.value !== "meet" || !Array.isArray(meetSearch.data)) return [];
  return meetSearch.data
    .slice(0, 20)
    .map((meeting: Omit<MeetResult, "resultType">) => ({
      ...meeting,
      resultType: "meeting" as const,
    }));
});
const contextSearchLabel = computed(
  () =>
    ({
      drive: "Drive",
      sheets: "Sheets",
      slides: "Slides",
      writer: "Writer",
      meet: "Meet",
      mail: "Mail",
      calendar: "Calendar",
    })[activeApp.value],
);
const palettePlaceholder = computed(() =>
  navigationMode.value
    ? "Switch apps"
    : `Search in ${contextSearchLabel.value || "Suite"}`,
);
const apps = computed(() =>
  getAppSwitcherItems(String(route.meta.appId ?? "")),
);
const filteredApps = computed(() => {
  if (activeApp.value === "mail" && mailAppliedFilters.value.length) return [];
  if (!appQuery.value) return apps.value;
  return apps.value.filter((app) =>
    `${app.title} ${app.name}`.toLowerCase().includes(appQuery.value),
  );
});
const exactApps = computed(() =>
  appQuery.value
    ? filteredApps.value.filter(
        (app) =>
          app.title.toLowerCase() === appQuery.value ||
          app.name.toLowerCase() === appQuery.value,
      )
    : [],
);
const remainingApps = computed(() =>
  filteredApps.value.filter((app) => !exactApps.value.includes(app)),
);
const filteredCommands = computed(() => {
  if (
    navigationMode.value ||
    (activeApp.value === "mail" && mailAppliedFilters.value.length)
  )
    return [];
  const commands = root.paletteGroups.flatMap((group) => group.commands);
  return commands.filter(
    (command) =>
      !(activeApp.value === "mail" && command.id === "mail-advanced-search") &&
      (!normalizedQuery.value ||
        [command.label, command.description, ...(command.keywords ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery.value)),
  );
});

function openMailAdvancedSearch() {
  const command = root.paletteGroups
    .flatMap((group) => group.commands)
    .find((candidate) => candidate.id === "mail-advanced-search");
  if (!command) return;
  const currentQuery = query.value;
  const filters = Object.fromEntries(
    mailAppliedFilters.value.map(({ key, value }) => [key, value]),
  );
  root.paletteOpen = false;
  command.run({ query: currentQuery, filters });
}

async function applyMailQuickFilter(
  option: (typeof mailFilterOptions)[number],
) {
  if ("value" in option && option.value) {
    applyMailFilter(option.key, option.value, option.displayValue);
    return;
  }
  if (!option.operator) return;
  query.value = `${query.value.trimEnd()}${query.value.trim() ? " " : ""}${option.operator}`;
  await nextTick();
  paletteInput.value?.$el.querySelector<HTMLInputElement>("input")?.focus();
}

watch(
  [
    driveResults,
    sheetResults,
    slideResults,
    writerResults,
    meetResults,
    mailResults,
    mailSuggestions,
  ],
  async (groups) => {
    if (!root.paletteOpen || !groups.some((items) => items.length)) return;
    await nextTick();
    const input =
      paletteInput.value?.$el.querySelector<HTMLInputElement>("input");
    if (!input) return;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
  },
  { flush: "post" },
);

watch(
  [query, mailAppliedFilters],
  ([value]) => {
    if (!navigationMode.value && value.trim() === ">") {
      navigationMode.value = true;
      query.value = "";
      resetSearches();
      return;
    }

    const text = value.trim();
    cancelSearches();
    if (navigationMode.value) return;

    if (activeApp.value === "mail") {
      const account = String(
        route.params.accountId || localStorage.getItem("mail-account-id") || "",
      );
      searchMail(value, account);
      return;
    }

    if (text.length < minimumQueryLength) {
      resetSearches();
      return;
    }

    if (activeApp.value === "drive") {
      driveSearch.submit({ query: text });
    } else if (activeApp.value === "sheets") {
      sheetSearch.submit({
        start: 0,
        limit: 20,
        search: text,
        owner_filter: "all",
        order_by: "modified",
        sort_dir: "desc",
      });
    } else if (activeApp.value === "slides") {
      slideSearch.submit({
        search: text,
        file_kinds: JSON.stringify(["Presentation"]),
        order_by: "modified",
        ascending: false,
        start: 0,
        limit: 20,
        paginated: true,
      });
    } else if (activeApp.value === "writer") {
      writerSearch.submit({ query: text });
    } else if (activeApp.value === "meet") {
      meetSearch.submit({
        doctype: "Meet Room",
        fields: ["name", "title", "modified"],
        or_filters: [
          ["Meet Room", "title", "like", `%${text}%`],
          ["Meet Room", "name", "like", `%${text}%`],
        ],
        order_by: "modified desc",
        limit_page_length: 20,
      });
    }
  },
  { deep: true },
);

watch(
  () => root.paletteOpen,
  (open) => {
    if (open) return;
    navigationMode.value = false;
    mailAppliedFilters.value = [];
    resetSearches();
  },
);

function resetSearches() {
  cancelSearches();
  for (const resource of [
    driveSearch,
    sheetSearch,
    slideSearch,
    writerSearch,
    meetSearch,
  ]) {
    resource.reset();
  }
  resetMailSearch();
}

function cancelSearches() {
  for (const resource of [
    driveSearch,
    sheetSearch,
    slideSearch,
    writerSearch,
    meetSearch,
  ]) {
    resource.submit.cancel();
    resource.abort();
  }
  cancelMailSearch();
}

function removeMailFilter(key: string) {
  mailAppliedFilters.value = mailAppliedFilters.value.filter(
    (filter) => filter.key !== key,
  );
}

function removeLastMailFilter(event: KeyboardEvent) {
  if (query.value || !mailAppliedFilters.value.length) return;
  event.preventDefault();
  mailAppliedFilters.value = mailAppliedFilters.value.slice(0, -1);
}

function handleModifiedEnter(event: KeyboardEvent) {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
  const activeItem = (
    event.currentTarget as HTMLElement
  ).querySelector<HTMLElement>(
    '[data-slot="command-palette-item"][data-state="active"]',
  );
  if (!activeItem) return;
  event.preventDefault();
  event.stopPropagation();
  openSelectionInNewTab = true;
  activeItem.click();
}

async function selectItem(
  item:
    | DriveResult
    | SheetResult
    | SlideResult
    | WriterResult
    | MeetResult
    | MailResult
    | MailContactSuggestion
    | MailFilterSuggestion
    | PaletteCommand
    | SuiteAppSwitcherItem,
  event: CommandPaletteSelectEvent,
) {
  const originalEvent = event.detail.originalEvent;
  const openInNewTab =
    openSelectionInNewTab || originalEvent.metaKey || originalEvent.ctrlKey;
  openSelectionInNewTab = false;
  if ("resultType" in item && item.resultType === "mail-contact") {
    event.preventDefault();
    selectMailContact(item);
    return;
  }
  if ("resultType" in item && item.resultType === "mail-filter-suggestion") {
    event.preventDefault();
    selectMailFilterSuggestion(item);
    return;
  }
  if ("run" in item) {
    await item.run({ query: query.value });
    return;
  }
  if ("route" in item) {
    if (openInNewTab) {
      window.open(item.route, "_blank", "noopener");
      return;
    }
    if (!item.spa) {
      window.location.assign(item.route);
      return;
    }
    await router.push(item.route);
    return;
  }
  if ("resultType" in item) {
    let location: RouteLocationRaw;
    if (item.resultType === "sheet") {
      location = { name: "sheets-editor", params: { id: item.name } };
    } else if (item.resultType === "slide") {
      location = {
        name: "slides-editor",
        params: { presentationId: item.content_docname },
        query: { slide: 1 },
      };
    } else if (item.resultType === "writer") {
      location = { name: "writer-document", params: { id: item.name } };
    } else if (item.resultType === "mail") {
      location = {
        name: "mail-mail",
        params: {
          accountId: item.account,
          mailbox: "search",
          threadID: item.thread_id,
        },
        query: mailFilter.value,
      };
    } else {
      location = { name: "meet-meeting", params: { meetingId: item.name } };
    }
    if (openInNewTab) {
      window.open(router.resolve(location).href, "_blank", "noopener");
    } else {
      await router.push(location);
    }
    return;
  }

  const { openEntity } = await import("@/apps/drive/utils/files");
  openEntity(item, openInNewTab);
}

onScopeDispose(() => {
  resetSearches();
});
</script>
