<template>
  <div class="home">
    <!-- Top bar -->
    <div class="home-topbar">
      <div class="home-brand">
        <!-- Brand mark from claude.ai/design handoff (logo/preview.html).
             Deep cyan #0E7490, rising line in #A5F0FA, white nodes. -->
        <svg width="28" height="28" viewBox="0 0 256 256" fill="none" style="flex-shrink:0">
          <rect width="256" height="256" rx="60" fill="#0E7490"/>
          <rect x="0.5" y="0.5" width="255" height="255" rx="59.5" stroke="white" stroke-opacity="0.12"/>
          <g stroke="white" stroke-opacity="0.18" stroke-width="2" stroke-linecap="round">
            <line x1="85"  y1="32"  x2="85"  y2="224"/>
            <line x1="171" y1="32"  x2="171" y2="224"/>
            <line x1="32"  y1="85"  x2="224" y2="85"/>
            <line x1="32"  y1="171" x2="224" y2="171"/>
          </g>
          <polyline points="48,180 96,148 136,164 184,80 216,108"
                    fill="none" stroke="#A5F0FA" stroke-width="18"
                    stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="136" cy="164" r="11" fill="white"/>
          <circle cx="184" cy="80"  r="11" fill="white"/>
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
        <!-- View-mode toggle: grid (card) vs list. State persists in
             localStorage so the user's choice survives reloads. Uses two
             Frappe UI Buttons inside a thin segmented frame; the active
             one switches to `subtle` so it inverts against the row. -->
        <div class="home-viewtoggle" role="tablist" aria-label="View mode">
          <Button
            :variant="viewMode === 'list' ? 'subtle' : 'ghost'"
            size="sm" icon="list"
            tooltip="List view"
            role="tab"
            :aria-selected="viewMode === 'list'"
            @click="setViewMode('list')"
          />
          <Button
            :variant="viewMode === 'grid' ? 'subtle' : 'ghost'"
            size="sm" icon="grid"
            tooltip="Grid view"
            role="tab"
            :aria-selected="viewMode === 'grid'"
            @click="setViewMode('grid')"
          />
        </div>
        <Button variant="solid" @click="newSheet()">New Sheet</Button>
      </div>
    </div>

    <!-- Content -->
    <div class="home-body">
      <!-- Loading -->
      <div v-if="loading" class="home-empty">
        <Spinner class="home-spinner" />
      </div>

      <!-- Empty state (no sheets at all) -->
      <div v-else-if="!sheets.length" class="home-empty">
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

      <!-- No search match (grid only — list mode delegates to ListView's
           built-in emptyState option). -->
      <div v-else-if="viewMode === 'grid' && !filteredSheets.length" class="home-empty">
        <p class="home-empty-title">No matches for “{{ searchQuery }}”</p>
        <p class="home-empty-sub">Try a different name.</p>
      </div>

      <!-- Sheet grid -->
      <div v-else-if="viewMode === 'grid'" class="home-grid">
        <div
          v-for="sheet in filteredSheets"
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
              <Dropdown :options="cardActions(sheet)" placement="right">
                <template #default="{ open }">
                  <Button :variant="open ? 'subtle' : 'ghost'" size="sm" icon="lucide-ellipsis-vertical" tooltip="Actions" />
                </template>
              </Dropdown>
            </div>
          </div>
        </div>
      </div>

      <!-- Sheet list — Frappe UI ListView. No custom wrapper; the
           component owns its header bg + row dividers. Empty / no-match
           states are handled via the options.emptyState contract. -->
      <ListView
        v-else
        :columns="listColumns"
        :rows="filteredSheets"
        row-key="name"
        :options="listOptions"
      >
        <template #cell="{ item, row, column }">
          <div
            v-if="column.key === '_actions'"
            class="flex w-full justify-end"
            @click.stop
          >
            <Dropdown :options="cardActions(row)" placement="right">
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
            :column="column"
            :row="row"
            :item="item"
            :align="column.align"
          />
        </template>
      </ListView>
    </div>

    <!-- Rename dialog -->
    <Dialog v-model="showRenameDialog" :options="{ title: 'Rename sheet', size: 'sm' }">
      <template #body-content>
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
      v-model="showDeleteDialog"
      :options="{ title: 'Delete sheet?', size: 'sm' }"
    >
      <template #body-content>
        <p class="home-confirm-text">
          "<strong>{{ deleteTarget?.title }}</strong>" will be permanently deleted.
        </p>
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button
            variant="solid"
            theme="red"
            :loading="deleting"
            @click="doDelete"
          >Delete</Button>
          <Button @click="showDeleteDialog = false">Cancel</Button>
        </div>
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted } from 'vue'
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  Spinner,
  FormControl,
  FeatherIcon,
  Dropdown,
  ListView,
  ListRowItem,
} from 'frappe-ui'
import { useRouter } from 'vue-router'

import { call } from '@/apps/sheets/utils/api.js'

const router = useRouter()

// The standalone app emitted `open`/`new` up to App.vue which then mutated the
// `?id=` query. Under the suite router we navigate directly to the editor
// route (':id'); `new` is the special create id, preserved verbatim.
function openSheet(name) {
  router.push({ name: 'sheets-editor', params: { id: name } })
}
function newSheet() {
  router.push({ name: 'sheets-editor', params: { id: 'new' } })
}

const sheets       = ref([])
const loading      = ref(true)
const searchQuery  = ref('')

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

// `emptyState` is ListView's built-in contract — it renders inside the
// component (below the header) when `rows` is empty, so we don't need an
// outer v-if branch for the no-match case in list mode.
const listOptions = computed(() => ({
  selectable: false,
  showTooltip: true,
  rowHeight: 40,
  onRowClick: (row) => openSheet(row.name),
  emptyState: searchQuery.value
    ? {
        title: `No matches for "${searchQuery.value}"`,
        description: 'Try a different name.',
      }
    : {
        title: 'No sheets yet',
        description: 'Create one to get started.',
        button: {
          label: 'New Sheet',
          variant: 'solid',
          onClick: () => newSheet(),
        },
      },
}))

// Filter by title, case-insensitive substring match. Sort order from the API
// (modified desc) is preserved by `filter`.
const filteredSheets = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return sheets.value
  return sheets.value.filter(s => (s.title || '').toLowerCase().includes(q))
})

// Per-card 3-dot menu. Rename/Delete are owner-only — both backend
// endpoints require write/delete perm, which a shared viewer/editor
// doesn't hold; surfacing the actions just to fail with a 403 is poor
// UX. Duplicate is always safe because the copy is owned by the caller.
function cardActions(sheet) {
  const actions = []
  if (isOwnedByMe(sheet)) {
    actions.push({ label: 'Rename', icon: 'edit-2', onClick: () => openRenameDialog(sheet) })
  }
  actions.push({ label: 'Duplicate', icon: 'copy', onClick: () => duplicate(sheet) })
  if (isOwnedByMe(sheet)) {
    actions.push({ label: 'Delete', icon: 'trash-2', onClick: () => confirmDelete(sheet) })
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

async function fetchSheets() {
  loading.value = true
  try {
    sheets.value = await call('suite.sheets.api.list_sheets')
  } finally {
    loading.value = false
  }
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

.home-body {
  flex: 1;
  min-height: 0;          /* lets flex children own their own scroll */
  overflow-y: auto;       /* the actual scroll container */
  padding: 40px 32px;
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

/* ── List view ─────────────────────────────────────────────────────────────
   Frappe UI's ListView owns its own header/row styling — header background,
   gridTemplateColumns, dividers, hover. We don't wrap it. */
</style>
