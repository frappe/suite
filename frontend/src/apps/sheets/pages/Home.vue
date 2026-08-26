<template>
  <div class="home">
    <!-- Top bar -->
    <div class="home-topbar">
      <div class="home-brand">
        <!-- Frappe Suite brand mark: green #278F5E rounded square, white
             spreadsheet glyph. Matches the app-launcher and sheet-editor icons. -->
        <svg width="28" height="28" viewBox="0 0 118 118" fill="none" style="flex-shrink:0">
          <path d="M93.9278 0H23.1013C10.3428 0 0 10.3428 0 23.1013V93.9278C0 106.686 10.3428 117.029 23.1013 117.029H93.9278C106.686 117.029 117.029 106.686 117.029 93.9278V23.1013C117.029 10.3428 106.686 0 93.9278 0Z" fill="#278F5E"/>
          <path d="M77.757 25.9364H23.5215V36.437H77.757C80.6447 36.437 83.0073 38.7996 83.0073 41.6873V75.3942C83.0073 78.2818 80.6447 80.6445 77.757 80.6445H39.2724C36.3847 80.6445 34.0221 78.2818 34.0221 75.3942V50.6653H23.5215V75.3942C23.5215 84.0572 30.6094 91.1451 39.2724 91.1451H77.757C86.42 91.1451 93.5079 84.0572 93.5079 75.3942V41.6873C93.5079 33.0243 86.42 25.9364 77.757 25.9364Z" fill="white"/>
          <path d="M53.8678 59.6958H43.3672V70.0914H53.8678V59.6958Z" fill="white"/>
          <path d="M73.6617 50.6653H63.1611V70.1439H73.6617V50.6653Z" fill="white"/>
        </svg>
        <span class="home-brand-name">Frappe Sheets</span>
      </div>
      <!-- Right-aligned controls. Wrapped in an explicit container with
           `margin-left: auto` because frappe-ui 1.0-beta's TextInput
           renders extra DOM around the input — relying on margin-left
           on the FormControl itself no longer reliably pushes the
           cluster to the right edge. -->
      <div class="home-topbar-right">
        <!-- Inline error banner — destructive actions (delete / duplicate)
             use this instead of `window.alert` so the chrome stays in-app
             and Espresso-themed. Auto-clears after 4 s. -->
        <Badge v-if="errorMessage" theme="red" variant="subtle" size="sm" :label="errorMessage" />
        <!-- View-mode toggle: grid (card) vs list. State persists in
             localStorage so the user's choice survives reloads. Uses two
             Frappe UI Buttons inside a thin segmented frame; the active
             one switches to `subtle` so it inverts against the row. -->
        <div class="home-viewtoggle" role="tablist" aria-label="View mode">
          <Button
            :variant="viewMode === 'list' ? 'subtle' : 'ghost'"
            size="sm" icon="lucide-list"
            tooltip="List view"
            role="tab"
            :aria-selected="viewMode === 'list'"
            @click="setViewMode('list')"
          />
          <Button
            :variant="viewMode === 'grid' ? 'subtle' : 'ghost'"
            size="sm" icon="lucide-grid-2x2"
            tooltip="Grid view"
            role="tab"
            :aria-selected="viewMode === 'grid'"
            @click="setViewMode('grid')"
          />
        </div>
        <!-- Overflow menu for secondary home-level destinations. Kept separate
             from the New Sheet CTA so a nav item isn't styled as a peer action. -->
        <Dropdown :options="overflowActions">
          <template #default="{ open }">
            <Button :variant="open ? 'subtle' : 'ghost'" size="sm" icon="lucide-ellipsis-vertical" tooltip="More" />
          </template>
        </Dropdown>
        <Button variant="solid" @click="newSheet()">New Sheet</Button>
      </div>
    </div>

    <!-- Filter toolbar — ownership tabs on the left, search on the right (the
         two list-narrowing controls sit together, matching the frappe-ui Files
         desktop layout). Hidden on the true-empty state so a brand-new account
         isn't offered filters over nothing; kept during load/errors so tab or
         search changes can still trigger a refetch. -->
    <div v-if="loading || loadError || !isTrueEmpty" class="home-toolbar">
      <div class="home-toolbar-inner">
        <TabButtons v-model="ownerTab" :options="ownerTabs" />
        <FormControl
          type="text"
          size="sm"
          class="home-search"
          v-model="searchQuery"
          placeholder="Search sheets…"
        >
          <template #prefix>
            <FeatherIcon name="search" class="home-search-icon" />
          </template>
        </FormControl>
      </div>
    </div>

    <!-- Loading (initial fetch or a filter/sort/search reset) -->
    <div v-if="loading" class="home-body">
      <div class="home-empty">
        <Spinner class="home-spinner" />
      </div>
    </div>

    <!-- Load failure — its own surface so stale rows from the previous
         filter are never shown under the new one, and the branded
         "No sheets yet" block can't masquerade as a successful result. -->
    <div v-else-if="loadError" class="home-body">
      <div class="home-empty">
        <p class="home-empty-title">Couldn't load sheets</p>
        <p class="home-empty-sub">{{ loadError }}</p>
        <Button variant="subtle" @click="fetchSheets()">Retry</Button>
      </div>
    </div>

    <!-- Empty state (no sheets at all, no filters in play) -->
    <div v-else-if="isTrueEmpty" class="home-body">
      <div class="home-empty">
        <div class="home-empty-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="8" fill="#f3f3f3"/>
            <rect x="10" y="10" width="13" height="13" rx="2" fill="#e2e2e2"/>
            <rect x="25" y="10" width="13" height="13" rx="2" fill="#e2e2e2"/>
            <rect x="10" y="25" width="13" height="13" rx="2" fill="#e2e2e2"/>
            <rect x="25" y="25" width="13" height="13" rx="2" fill="#e2e2e2"/>
          </svg>
        </div>
        <p class="home-empty-title">No sheets yet</p>
        <p class="home-empty-sub">Create one to get started</p>
        <Button variant="solid" @click="newSheet()">New Sheet</Button>
      </div>
    </div>

    <!-- Sheet grid — keeps the whole-body scroll; Load More is a plain
         centered button (ListFooter is list-view chrome). -->
    <div v-else-if="viewMode === 'grid'" class="home-body">
      <div v-if="!sheets.length" class="home-empty">
        <p class="home-empty-title">{{ filteredEmptyState.title }}</p>
        <p class="home-empty-sub">{{ filteredEmptyState.description }}</p>
        <Button v-if="filteredEmptyState.button" variant="solid" @click="newSheet()">New Sheet</Button>
      </div>
      <template v-else>
      <div class="home-grid">
        <div
          v-for="sheet in sheets"
          :key="sheet.name"
          class="home-card"
          @click="openSheet(sheet.name)"
        >
          <!-- Preview placeholder -->
          <div class="home-card-preview">
            <svg width="100%" height="100%" viewBox="0 0 200 120" fill="none" preserveAspectRatio="xMidYMid meet">
              <rect width="200" height="120" fill="#F8F8F8"/>
              <line x1="0" y1="24" x2="200" y2="24" stroke="#E2E2E2"/>
              <line x1="0" y1="48" x2="200" y2="48" stroke="#E2E2E2"/>
              <line x1="0" y1="72" x2="200" y2="72" stroke="#E2E2E2"/>
              <line x1="0" y1="96" x2="200" y2="96" stroke="#E2E2E2"/>
              <line x1="40" y1="0" x2="40" y2="120" stroke="#E2E2E2"/>
              <line x1="100" y1="0" x2="100" y2="120" stroke="#E2E2E2"/>
              <line x1="160" y1="0" x2="160" y2="120" stroke="#E2E2E2"/>
              <rect x="8"   y="8"  width="24" height="9" rx="2" fill="#E2E2E2"/>
              <rect x="48"  y="8"  width="36" height="9" rx="2" fill="#C7C7C7"/>
              <rect x="108" y="8"  width="20" height="9" rx="2" fill="#E2E2E2"/>
              <rect x="48"  y="32" width="28" height="8" rx="2" fill="#EDEDED"/>
              <rect x="48"  y="56" width="44" height="8" rx="2" fill="#EDEDED"/>
              <rect x="48"  y="80" width="20" height="8" rx="2" fill="#EDEDED"/>
            </svg>
          </div>

          <!-- Card footer -->
          <div class="home-card-footer">
            <div class="home-card-info">
              <span class="home-card-title">{{ sheet.title }}</span>
              <span class="home-card-date">
                <template v-if="!isOwnedByMe(sheet)">Shared · </template>{{ formatDate(sheet.modified) }}
              </span>
            </div>
            <div class="home-card-menu" @click.stop>
              <Dropdown :options="cardActions(sheet)" align="end">
                <template #default="{ open }">
                  <Button :variant="open ? 'subtle' : 'ghost'" size="sm" icon="lucide-ellipsis-vertical" tooltip="Actions" />
                </template>
              </Dropdown>
            </div>
          </div>
        </div>
      </div>
      <div class="home-loadmore">
        <Button
          v-if="sheets.length < total"
          variant="subtle"
          :loading="loadingMore"
          @click="loadMore"
        >Load more</Button>
        <span class="home-count">{{ sheets.length }} of {{ total }}</span>
      </div>
      </template>
    </div>

    <!-- Sheet list — composed from Frappe UI's native list primitives so the
         header, groups, rows, and empty state share one layout contract. -->
    <div v-else class="home-body">
      <div class="flex min-h-full flex-col gap-2">
      <ListView
        class="!w-full"
        :columns="listColumns"
        :rows="listRows"
        row-key="name"
        :options="listOptions"
      >
        <template #default="{ showGroupedRows }">
          <ListHeader>
            <button
              v-for="col in listColumns"
              :key="col.key"
              type="button"
              class="flex min-w-0 items-center gap-1 text-left text-base text-ink-gray-5"
              :class="{ 'font-medium text-ink-gray-8': sortBy === col.key }"
              :disabled="col.key === '_actions'"
              :aria-sort="sortBy === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined"
              @click="col.key !== '_actions' && setSort(col.key)"
            >
              <span class="truncate">{{ col.label }}</span>
              <FeatherIcon
                v-if="sortBy === col.key"
                :name="sortDir === 'asc' ? 'arrow-up' : 'arrow-down'"
                class="size-3.5 shrink-0"
              />
            </button>
          </ListHeader>
          <ListGroups v-if="listRows.length && showGroupedRows" />
          <ListRows v-else-if="listRows.length" />
          <ListEmptyState v-else />
        </template>
        <template #cell="{ item, row, column }">
          <div
            v-if="column.key === '_actions'"
            class="flex w-full justify-end"
            @click.stop
          >
            <Dropdown :options="cardActions(row)" align="end">
              <template #default="{ open }">
                <Button
                  :variant="open ? 'subtle' : 'ghost'"
                  size="sm"
                  icon="lucide-ellipsis-vertical"
                  tooltip="Actions"
                />
              </template>
            </Dropdown>
          </div>
          <ListRowItem
            v-else
            class="min-w-0"
            :column="column"
            :row="row"
            :item="item"
            :align="column.align"
          />
        </template>
      </ListView>
      <div v-if="sheets.length" class="flex items-center justify-end gap-3 border-t border-outline-gray-2 pt-2">
        <Button v-if="sheets.length < total" label="Load More" :loading="loadingMore" @click="loadMore" />
        <div class="flex items-center gap-1 text-base text-ink-gray-5">
          <span>{{ sheets.length }}</span><span>of</span><span>{{ total }}</span>
        </div>
      </div>
      </div>
    </div>

    <!-- Rename dialog -->
    <Dialog v-model:open="showRenameDialog" title="Rename sheet" size="sm">
      <template #default>
        <FormControl v-model="renameValue" label="New title" placeholder="Untitled Sheet" @keydown.enter="confirmRename" />
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button variant="solid" :loading="renaming" @click="confirmRename">Rename</Button>
          <Button @click="showRenameDialog = false">Cancel</Button>
        </div>
      </template>
    </Dialog>

    <!-- Delete confirm dialog -->
    <Dialog
      v-model:open="showDeleteDialog"
      title="Move to trash?"
      size="sm"
    >
      <template #default>
        <p class="home-confirm-text">
          "<strong>{{ deleteTarget?.title }}</strong>" will be moved to Trash. You
          can restore it from there before it's permanently deleted.
        </p>
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button
            variant="solid"
            theme="red"
            :loading="deleting"
            @click="doDelete"
          >Move to trash</Button>
          <Button @click="showDeleteDialog = false">Cancel</Button>
        </div>
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted, watch } from 'vue'
import {
  Avatar, Badge, Button, Dialog, Spinner, FormControl, Dropdown, TabButtons, debounce } from 'frappe-ui'
import {
  Icon as FeatherIcon,
  ListEmptyState,
  ListGroups,
  ListHeader,
  ListRows,
  ListRowItem,
  ListView,
} from 'frappe-ui/experimental'
import { useRouter } from 'vue-router'

import { call } from '@/apps/sheets/utils/api.js'
import { groupSheetsByRecency, parseFrappeDatetime } from '@/apps/sheets/utils/recency-groups.js'

const router = useRouter()

// Navigate directly to the editor route (':id'); `new` is the special create id.
function openSheet(name) {
  router.push({ name: 'sheets-editor', params: { id: name } })
}
function newSheet() {
  router.push({ name: 'sheets-editor', params: { id: 'new' } })
}

// Top-level overflow menu (the ⋮ next to New Sheet). Just Trash for now; this
// is the home for future home-level destinations (Shared, Settings, …).
const overflowActions = [
  { label: 'Trash', icon: 'lucide-trash-2', onClick: () => router.push({ name: 'sheets-trash' }) },
]

const PAGE_SIZE = 50

const sheets      = ref([])   // accumulated pages, in server sort order
const total       = ref(0)    // permission-aware count for the active filters
const loading     = ref(true) // initial load + any filter/sort/search reset
const loadingMore = ref(false)
const searchQuery = ref('')   // matched server-side (debounced) so results
                              // aren't limited to already-loaded pages
const ownerTab    = ref('all')      // 'all' | 'mine' | 'shared'
const sortBy      = ref('modified') // 'modified' | 'title' | 'owner'
const sortDir     = ref('desc')     // 'asc' | 'desc' — toggled from the header
const loadError   = ref('')   // reset-fetch failure; owns its own surface so
                              // stale rows never render under a new filter
const serverNow   = ref('')   // server-clock "now" from the API — same naive
                              // frame as `modified`, keeps recency buckets
                              // timezone-consistent

// Inline error banner used by the destructive actions (delete / duplicate).
// Mirrors the editor's `saveError` pattern — Frappe UI Badge, auto-dismissed
// after a few seconds — so we never reach for `window.alert`.
const errorMessage = ref('')
function _flashError(msg) {
  errorMessage.value = msg
  setTimeout(() => { if (errorMessage.value === msg) errorMessage.value = '' }, 4000)
}

// Persisted view preference. Default to list for a dense, scannable
// listing; users who prefer the card previews opt into grid.
const VIEW_KEY = 'frappe_sheets:home_view_mode'
const viewMode = ref(_readViewMode())

function _readViewMode() {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'list' || v === 'grid' ? v : 'list'
  } catch (_) {
    return 'list'
  }
}

function setViewMode(mode) {
  if (mode !== 'grid' && mode !== 'list') return
  viewMode.value = mode
  try { localStorage.setItem(VIEW_KEY, mode) } catch (_) { /* private mode */ }
}

// Ownership comes from the API as a server-computed `is_owner` flag,
// because the SPA's index.html template doesn't inject the standard
// `window.frappe.session` bootinfo — the client can't reliably know
// the logged-in user on its own. Comparing sheet.owner against an empty
// `window.frappe?.session?.user` made every sheet look "shared" and
// hid the owner-only Rename/Delete actions.
function isOwnedByMe(sheet) { return !!sheet.is_owner }

function shortOwner(sheet) {
  const u = sheet.owner
  if (!u) return ''
  if (sheet.is_owner) return 'me'
  return u.includes('@') ? u.split('@')[0] : u
}

// Two-letter initials for the Avatar prefix on the Owner column. Drops the
// email domain first ("alice@x.com" → "alice") so the label is initial-derived
// rather than "AL".
function ownerInitials(sheet) {
  const handle = (sheet.owner || '').split('@')[0]
  const parts = handle.split(/[._-]+/).filter(Boolean)
  const letters = (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  return letters.toUpperCase() || '?'
}

// Frappe UI ListView column definitions. Trailing `_actions` column holds the
// 3-dot menu — rendered via the #cell slot since ListRowItem can't host a
// Dropdown trigger directly.
const listColumns = [
  {
    label: 'Name',
    key: 'title',
    width: 3,
    prefix: () =>
      h(FeatherIcon, {
        name: 'file-text',
        class: 'h-4 w-4 text-ink-gray-5 shrink-0',
      }),
  },
  {
    label: 'Owner',
    key: 'owner',
    width: 1,
    getLabel: ({ row }) => shortOwner(row),
    prefix: ({ row }) =>
      h(Avatar, { label: ownerInitials(row), size: 'xs', shape: 'circle' }),
  },
  {
    label: 'Last Modified',
    key: 'modified',
    width: 1,
    getLabel: ({ row }) => formatDate(row.modified),
  },
  { label: '', key: '_actions', width: '60px', align: 'right' },
]

const ownerTabs = [
  { label: 'All', value: 'all' },
  { label: 'My sheets', value: 'mine' },
  { label: 'Shared with me', value: 'shared' },
]

// The direction a column sorts by when it first becomes active: dates read
// newest-first, text/owner read A→Z. Re-clicking the active column toggles.
const SORT_DEFAULT_DIR = { modified: 'desc', title: 'asc', owner: 'asc' }

function setSort(key) {
  if (sortBy.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = key
    sortDir.value = SORT_DEFAULT_DIR[key] || 'desc'
  }
}

// "Truly" empty = the account has no visible sheets at all, as opposed to
// a search/tab combination that matched nothing. Gets the branded block.
const isTrueEmpty = computed(
  () => !sheets.value.length && !searchQuery.value.trim() && ownerTab.value === 'all'
)

// Empty-state copy when a search or tab filtered everything out. Reached
// only when !isTrueEmpty, so no search + non-"shared" tab implies "mine".
// Shared by ListView's emptyState contract and the grid empty branch.
const filteredEmptyState = computed(() => {
  const q = searchQuery.value.trim()
  if (q) {
    return { title: `No matches for "${q}"`, description: 'Try a different name.' }
  }
  if (ownerTab.value === 'shared') {
    return {
      title: 'Nothing shared with you yet',
      description: 'Sheets others share with you show up here.',
    }
  }
  return {
    title: "You don't own any sheets yet",
    description: 'Create one to get started.',
    button: { label: 'New Sheet', variant: 'solid', onClick: () => newSheet() },
  }
})

// `emptyState` is ListView's built-in contract — it renders inside the
// component (below the header) when `rows` is empty.
const listOptions = computed(() => ({
  selectable: false,
  showTooltip: true,
  rowHeight: 40,
  onRowClick: (row) => openSheet(row.name),
  emptyState: filteredEmptyState.value,
}))

// List rows, grouped by recency only under the default modified sort —
// time buckets make no sense against a name/owner ordering. Rebuilt via a
// watch (not a computed) so each rebuild can carry forward the `collapsed`
// flags that ListView's group headers mutate in place; a computed would
// re-expand every group on Load More.
const listRows = ref([])
watch(
  [sheets, sortBy, sortDir],
  () => {
    // Recency buckets (Today / Previous 7 days / …) only read correctly under
    // the default newest-first modified sort; any other column — or modified
    // ascending — renders a flat list so the ordering isn't fought by buckets.
    const grouped = sortBy.value === 'modified' && sortDir.value === 'desc'
    // Bucket against the server's clock so "Today" is decided in the same
    // timezone frame the `modified` timestamps are written in.
    const now = serverNow.value ? parseFrappeDatetime(serverNow.value) : new Date()
    listRows.value = grouped
      ? groupSheetsByRecency(sheets.value, now, listRows.value)
      : sheets.value
  },
  { immediate: true }
)

// Per-card 3-dot menu. Rename/Delete are owner-only — both backend
// endpoints require write/delete perm, which a shared viewer/editor
// doesn't hold; surfacing the actions just to fail with a 403 is poor
// UX. Duplicate is always safe because the copy is owned by the caller.
function cardActions(sheet) {
  const actions = []
  if (isOwnedByMe(sheet)) {
    actions.push({ label: 'Rename', icon: 'lucide-edit-2', onClick: () => openRenameDialog(sheet) })
  }
  actions.push({ label: 'Duplicate', icon: 'lucide-copy', onClick: () => duplicate(sheet) })
  if (isOwnedByMe(sheet)) {
    actions.push({ label: 'Delete', icon: 'lucide-trash-2', onClick: () => confirmDelete(sheet) })
  }
  return actions
}

const showDeleteDialog = ref(false)
const deleteTarget     = ref(null)
const deleting         = ref(false)

const showRenameDialog = ref(false)
const renameTarget     = ref(null)
const renameValue      = ref('')
const renaming         = ref(false)

onMounted(fetchSheets)

// Filters reset the page visibly; sorting keeps the current rows on screen
// while the reordered first page loads.
watch(ownerTab, () => fetchSheets())
watch([sortBy, sortDir], () => fetchSheets({ background: true }))
watch(searchQuery, debounce(() => fetchSheets(), 300))

// Monotonic token invalidates in-flight responses, so a slow page-1 fetch
// can't clobber the rows of a newer tab/sort/search request.
let reqToken = 0

async function fetchSheets({ append = false, background = false } = {}) {
  const token = ++reqToken
  if (append) loadingMore.value = true
  else if (!background) loading.value = true
  try {
    const res = await call('suite.sheets.api.list_sheets', {
      start: append ? sheets.value.length : 0,
      limit: PAGE_SIZE,
      search: searchQuery.value.trim(),
      owner_filter: ownerTab.value,
      order_by: sortBy.value,
      sort_dir: sortDir.value,
    })
    if (token !== reqToken) return
    sheets.value = append ? sheets.value.concat(res.sheets) : res.sheets
    total.value = res.total
    serverNow.value = res.now || ''
    loadError.value = ''
  } catch (err) {
    if (token !== reqToken) return
    console.error('list_sheets failed:', err)
    if (append || background) {
      // Keep what's already on screen; surface the failure via the badge.
      _flashError(err?.message || (append ? 'Load more failed' : 'Could not sort sheets'))
    } else {
      // A failed reset must not leave the previous filter's rows rendered
      // under the new tab/sort/search — clear and show the error surface.
      sheets.value = []
      total.value = 0
      loadError.value = err?.message || 'Something went wrong. Check your connection and retry.'
    }
  } finally {
    if (token === reqToken) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function loadMore() {
  if (loading.value || loadingMore.value) return
  if (sheets.value.length >= total.value) return
  fetchSheets({ append: true })
}

function formatDate(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60)           return 'just now'
  if (diff < 3600)         return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)        return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7)   return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString()
}

function confirmDelete(sheet) {
  deleteTarget.value    = sheet
  showDeleteDialog.value = true
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await call('suite.sheets.api.delete_sheet', { name: deleteTarget.value.name })
    sheets.value = sheets.value.filter(s => s.name !== deleteTarget.value.name)
    total.value = Math.max(0, total.value - 1)
    showDeleteDialog.value = false
  } catch (err) {
    console.error('Delete failed:', err)
    _flashError(err?.message || 'Delete failed')
  } finally {
    deleting.value = false
  }
}

function openRenameDialog(sheet) {
  renameTarget.value     = sheet
  renameValue.value      = sheet.title || ''
  showRenameDialog.value = true
}

async function confirmRename() {
  const target = renameTarget.value
  const title  = renameValue.value.trim()
  if (!target || !title) return
  renaming.value = true
  try {
    await call('suite.sheets.api.rename_sheet', { name: target.name, title })
    const found = sheets.value.find(s => s.name === target.name)
    if (found) found.title = title
    showRenameDialog.value = false
  } finally {
    renaming.value = false
  }
}

async function duplicate(sheet) {
  try {
    await call('suite.sheets.api.duplicate_sheet', { name: sheet.name })
    // Refresh the listing so the new doc shows up with its modified timestamp.
    await fetchSheets()
  } catch (err) {
    // Surface the failure instead of silently swallowing — keeps "nothing
    // happened" from being indistinguishable from server errors.
    console.error('Duplicate failed:', err)
    _flashError(err?.message || 'Duplicate failed')
  }
}
</script>

<style scoped>
/* Espresso tokens — every color comes from frappe-ui's semantic palette. */
.home {
  display: flex;
  flex-direction: column;
  /* The global stylesheet locks <html/body/#root> at 100% with overflow:hidden
     (the editor wants pixel-perfect viewport control). So Home owns its own
     scroll: a fixed-height column where the body region scrolls. */
  height: 100vh;
  background: var(--surface-base);
  font-family: InterVar, ui-sans-serif, system-ui, sans-serif;
  color: var(--ink-gray-9);
}

.home-topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 32px;
  height: 48px;
  background: var(--surface-base);
  border-bottom: 1px solid var(--outline-gray-2);
  flex-shrink: 0;
}

.home-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* Right-aligned cluster: search + view toggle + New Sheet button.
   `margin-left: auto` pushes the whole group to the right edge, leaving
   the brand mark anchored at the left. */
.home-topbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-left: auto;
}

/* Search input — compact, fixed 220px so it doesn't dominate the topbar. */
.home-search       { width: 220px; }
.home-search :deep(input) { height: 28px; font-size: 13px; }
.home-search-icon  { width: 13px; height: 13px; color: var(--ink-gray-5); }

.home-brand-name {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: .01em;
  color: var(--ink-gray-9);
}

/* Filter toolbar — sits between the topbar and content, outside any scroll
   region so it stays put in both view modes. */
.home-toolbar {
  flex-shrink: 0;
  padding: 16px 32px 8px;
}
.home-toolbar-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.home-body {
  flex: 1;
  min-height: 0;          /* lets flex children own their own scroll */
  overflow-y: auto;       /* the actual scroll container */
  padding: 16px 32px 40px;
  width: 100%;
}

/* Inner constraint so the grid/list don't stretch full-width on big monitors
   but the scrollbar still tracks the full viewport on the right edge. */
.home-body > * {
  max-width: 1200px;
  margin-left: auto;
  margin-right: auto;
}

/* Loading / empty */
.home-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 300px;
  color: var(--ink-gray-5);
}
.home-spinner       { width: 32px; height: 32px; color: var(--ink-gray-5); }
.home-empty-icon    { margin-bottom: 4px; }
.home-empty-title   { font-size: 15px; font-weight: 500; letter-spacing: .01em; color: var(--ink-gray-8); margin: 0; }
.home-empty-sub     { font-size: 13px; letter-spacing: .02em; color: var(--ink-gray-5); margin: 0 0 8px; }

/* Grid */
.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}

.home-card {
  background: var(--surface-elevation-1);
  border: 1px solid var(--outline-gray-2);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow .15s, border-color .15s, transform .15s;
}
.home-card:hover {
  border-color: var(--outline-gray-3);
  box-shadow: 0 0 1px rgba(0,0,0,.35), 0 6px 8px -4px rgba(0,0,0,.1);
}

.home-card-preview {
  height: 130px;
  background: var(--surface-gray-1);
  border-bottom: 1px solid var(--outline-gray-2);
  overflow: hidden;
}

.home-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  gap: 8px;
}

.home-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.home-card-title {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: .01em;
  color: var(--ink-gray-9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.home-card-date {
  font-size: 11px;
  letter-spacing: .02em;
  color: var(--ink-gray-5);
}

/* Per-card 3-dot menu — shown on hover only, like Google Sheets. */
.home-card-menu {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity .15s;
}
.home-card:hover .home-card-menu { opacity: 1; }
/* Keep the menu visible while its dropdown is open so the trigger doesn't
   vanish when the user moves the cursor onto the menu. */
.home-card-menu:has([data-headlessui-state~="open"]) { opacity: 1; }

.home-confirm-text {
  font-size: 14px;
  letter-spacing: .02em;
  color: var(--ink-gray-7);
  margin: 0;
}

/* ── View-mode toggle ──────────────────────────────────────────────────────
   Segmented control: thin frame around two Frappe UI Buttons. The Buttons
   own their own padding/typography; the wrapper just gives them the
   shared border + 2px inner gutter that makes them read as one control. */
.home-viewtoggle {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--outline-gray-2);
  border-radius: 8px;
  padding: 2px;
  background: var(--surface-base);
  flex-shrink: 0;
}

/* Grid-mode Load More — centered button + quiet count below the cards. */
.home-loadmore {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px 0;
}
.home-count {
  font-size: 12px;
  letter-spacing: .02em;
  color: var(--ink-gray-5);
}

</style>
