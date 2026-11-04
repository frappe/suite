<template>
  <div class="drive-picker">
    <!-- Tabs: My files, and Organization files on a business site -->
    <div class="tab-bar">
      <button v-for="t in tabs" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="switchTab(t.key)">
        <span class="tab-icon" v-html="t.icon" />
        {{ t.label }}
      </button>
    </div>

    <!-- Search -->
    <input v-model="searchText" type="search" class="search" :placeholder="__('Search')" />

    <!-- Breadcrumbs (hidden while searching) -->
    <div v-if="!searching" class="crumbs">
      <template v-for="(c, i) in crumbs" :key="c.node">
        <button class="crumb" :class="{ last: i === crumbs.length - 1 }" @click="goTo(i)">
          {{ c.label }}
        </button>
        <span v-if="i < crumbs.length - 1" class="crumb-sep">/</span>
      </template>
    </div>
    <div v-else class="crumbs">
      <span class="crumb last">{{ __('Search results') }}</span>
    </div>

    <!-- List -->
    <div ref="listEl" class="list" @scroll="onScroll">
      <div v-if="loading" class="state">
        <span class="spinner-border spinner-border-sm" />
      </div>
      <div v-else-if="failure" class="state muted">{{ failure }}</div>
      <div v-else-if="!rows.length" class="state muted">
        {{ searching ? __('No matches') : __('Empty folder') }}
      </div>
      <button v-for="row in rows" :key="row.name" class="file-row"
        :class="{ selected: selected && selected.name === row.name }" @click="onRow(row)"
        @dblclick="row.kind === 'folder' && openFolder(row)">
        <img class="row-icon" :src="iconUrl(row)" @error="$event.target.src = UNKNOWN_ICON" />
        <span class="row-name" :title="row.title">{{ row.title }}</span>
        <span v-if="row.kind === 'folder'" class="row-chevron" v-html="chevronIcon" />
      </button>
      <div v-if="loadingMore" class="state">
        <span class="spinner-border spinner-border-sm" />
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-info">
        <span v-if="oversized" class="footer-error">
          {{ __('Files larger than {0} MB cannot be attached.', [Number((maxFileSize / (1024 * 1024)).toFixed(2))]) }}
        </span>
        <template v-else-if="staged">
          {{ __('Upload') }} <b>{{ staged.name }}</b> {{ __('to') }}
          <b>{{ here.label }}</b>
        </template>
        <template v-else-if="selected">
          <b>{{ selected.title }}</b>
        </template>
        <template v-else-if="canUpload">
          {{ __('Choose a file, or open a folder') }}
        </template>
        <template v-else>{{ __('Choose a file to attach') }}</template>
      </div>

      <input ref="fileInput" type="file" class="hidden" @change="onStage" />
      <label v-if="canTogglePrivate" class="private-toggle">
        <input v-model="isPrivate" type="checkbox" />
        {{ __('Private') }}
      </label>
      <button v-if="canUpload" class="ghost-btn" @click="$refs.fileInput.click()">
        {{ __('Upload new') }}
      </button>
      <button class="primary-btn" :disabled="!ready || busy" @click="submit">
        <span v-if="busy" class="spinner-border spinner-border-sm" />
        <template v-else>{{ staged ? __('Upload & attach') : __('Attach') }}</template>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'

// Every call goes to Drive's routes under /api/suite/drive/, never to a
// legacy Drive API method (ticket 017).
const DRIVE = '/api/suite/drive'
const PAGE = 50
const CHUNK = 8 * 1024 * 1024
// Drive roles (Drive spec §4): UPLOAD may add files to a folder.
const UPLOAD = 30

const chevronIcon =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'

const props = defineProps({
  uploader: { type: Object, required: true },
  onComplete: { type: Function, default: () => { } },
})

// The framework uploader's own settings. A device file starts private unless the
// caller asked for public attachments and the user may upload public files; the
// toggle shows only where the framework shows it.
const uploaderProps = props.uploader.$props ?? {}
const canTogglePrivate = !!uploaderProps.allow_toggle_private
const isPrivate = ref(!uploaderProps.make_attachments_public || !frappe.utils.can_upload_public_files())

// Attaching sends the bytes through the browser, so the framework's own size
// limit applies before any byte moves. It is fetched when the uploader has not.
const maxFileSize = ref(uploaderProps.restrictions?.max_file_size ?? null)
if (maxFileSize.value == null) {
  frappe.call('frappe.core.api.file.get_max_file_size').then((res) => {
    maxFileSize.value = Number(res.message) || null
  })
}
function tooLarge(size) {
  return maxFileSize.value != null && size != null && size > maxFileSize.value
}

const discovered = ref({ personal: null, organization: null })
const tabs = computed(() => [
  { key: 'personal', label: __('My files'), icon: frappe.utils.icon('home', 'sm') },
  ...(discovered.value.organization
    ? [{ key: 'organization', label: __('Organization files'), icon: frappe.utils.icon('users', 'sm') }]
    : []),
])

const tab = ref('personal')
const rows = ref([])
const loading = ref(false) // initial page
const loadingMore = ref(false) // appending next page
const failure = ref('')
const selected = ref(null)
const staged = ref(null)
const busy = ref(false)
const fileInput = ref(null)
const listEl = ref(null)

const cursor = ref(null)
const searchText = ref('')
const searching = computed(() => searchText.value.trim().length >= 2)

// Breadcrumb trail for the active tab. The tip is the current folder, which is
// also the upload destination. `role` is the caller's Drive role on it.
const crumbs = ref([])
const here = computed(() => crumbs.value[crumbs.value.length - 1] ?? { node: '', label: '', role: 0 })
const canUpload = computed(() => !searching.value && here.value.role >= UPLOAD)
const pickedSize = computed(() => staged.value?.size ?? selected.value?.size ?? null)
const oversized = computed(() => tooLarge(pickedSize.value))
const ready = computed(() => !oversized.value && (staged.value ? canUpload.value : !!selected.value))

onMounted(async () => {
  loading.value = true
  try {
    discovered.value = await drive('GET', 'roots')
  } catch (err) {
    failure.value = err.message
    loading.value = false
    return
  }
  switchTab('personal')
})

async function switchTab(key) {
  tab.value = key
  searchText.value = ''
  selected.value = null
  staged.value = null
  const root = discovered.value[key]
  if (!root) return
  // The root crumb carries the tab's name, as in the Files sidebar.
  const label = tabs.value.find((t) => t.key === key)?.label ?? root.title
  crumbs.value = [{ node: root.node, label, role: 0 }]
  reload()
  // The root row is not in any listing, so its role needs one read.
  const detail = await drive('GET', `nodes/${encodeURIComponent(root.node)}`, { query: { expand: 'access' } }).catch(() => null)
  if (detail && crumbs.value[0]?.node === root.node) crumbs.value[0].role = detail.access?.role ?? 0
}

function openFolder(row) {
  searchText.value = ''
  selected.value = null
  crumbs.value.push({ node: row.name, label: row.title, role: row.access?.role ?? 0 })
  reload()
}

function goTo(i) {
  if (i === crumbs.value.length - 1) return
  selected.value = null
  crumbs.value = crumbs.value.slice(0, i + 1)
  reload()
}

function onRow(row) {
  if (row.kind === 'folder') return openFolder(row)
  selected.value = row
  staged.value = null
}

function onStage(e) {
  staged.value = e.target.files[0] || null
  selected.value = null
}

// Re-fetch from the first page (tab/folder change or a new search).
let generation = 0
async function reload() {
  const current = ++generation
  cursor.value = null
  rows.value = []
  failure.value = ''
  loading.value = true
  try {
    const page = await fetchFilled(null)
    if (current !== generation) return
    rows.value = sortRows(page.rows)
    cursor.value = page.next_cursor
  } catch (err) {
    if (current === generation) failure.value = err.message
  } finally {
    if (current === generation) loading.value = false
  }
  topUp()
}

async function loadMore() {
  if (loadingMore.value || loading.value || !cursor.value) return
  const current = generation
  loadingMore.value = true
  try {
    const page = await fetchFilled(cursor.value)
    if (current !== generation) return
    rows.value = rows.value.concat(sortRows(page.rows))
    cursor.value = page.next_cursor
  } catch (err) {
    if (current === generation) failure.value = err.message
  } finally {
    loadingMore.value = false
  }
  topUp()
}

function onScroll(e) {
  const el = e.target
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) loadMore()
}

// A short first page may not fill the scroll area; keep topping up.
function topUp() {
  requestAnimationFrame(() => {
    const el = listEl.value
    if (el && cursor.value && el.scrollHeight <= el.clientHeight) loadMore()
  })
}

const sortRows = (items) =>
  items.slice().sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder'))

// Only folders and stored files can reach a Desk attachment. Documents have no
// stored bytes, and links point elsewhere.
const attachable = (row) => row.kind === 'folder' || row.kind === 'file'

// One page: the current folder's children, or a search over what the caller
// may read. `rows` keeps only attachable nodes.
async function fetchPage(after) {
  const q = searchText.value.trim()
  const page = q.length >= 2
    ? await drive('GET', 'views/search', { query: { term: q, limit: PAGE, cursor: after, expand: 'access' } })
    : here.value.node
      ? await drive('GET', `nodes/${encodeURIComponent(here.value.node)}/children`, {
        query: { limit: PAGE, cursor: after, order_by: 'title', ascending: 1, expand: 'access' },
      })
      : { rows: [], next_cursor: null }
  return { rows: page.rows.filter(attachable), next_cursor: page.next_cursor }
}

// The filter can leave a server page short or empty. Keep reading until a
// page's worth of rows arrives or the cursor runs out.
async function fetchFilled(after) {
  const collected = []
  let next = after
  do {
    const page = await fetchPage(next)
    collected.push(...page.rows)
    next = page.next_cursor
  } while (collected.length < PAGE && next)
  return { rows: collected, next_cursor: next }
}

let searchTimer = null
watch(searchText, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(reload, 300)
})

// ---- file-type icons (matches Drive's list view) ----
const ICON_BASE = '/assets/suite/drive/images/icons'
const UNKNOWN_ICON = `${ICON_BASE}/unknown.svg`

// Maps a file extension to one of Drive's icon names.
const EXT_ICON = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', heic: 'image', bmp: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio',
  zip: 'archive', tar: 'archive', gz: 'archive', rar: 'archive', '7z': 'archive',
  doc: 'word', docx: 'word',
  xls: 'excel', xlsx: 'excel', csv: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation',
  md: 'markdown', txt: 'text',
  py: 'code', js: 'code', ts: 'code', json: 'code', html: 'code', css: 'code', vue: 'code',
}

function iconUrl(row) {
  if (row.kind === 'folder') return `${ICON_BASE}/folder.svg`
  const ext = (row.title || '').split('.').pop().toLowerCase()
  return `${ICON_BASE}/${EXT_ICON[ext] || 'unknown'}.svg`
}

// ---- actions ----
async function submit() {
  busy.value = true
  try {
    if (staged.value) {
      await driveUpload(staged.value, here.value.node)
      await attach(staged.value)
    } else {
      await attach(await readContent(selected.value))
    }
    props.onComplete()
  } catch (err) {
    // The framework uploader reports its own refusals and rejects without an error.
    if (err instanceof Error) {
      frappe.msgprint({ title: __('Upload failed'), message: err.message, indicator: 'red' })
    }
  } finally {
    busy.value = false
  }
}

// Hand the bytes to the framework engine, so the caller's on_success (field and
// attachments) fires exactly as for a file from the device. Storage keeps one
// copy of identical bytes. The bytes pass through the browser once, so `ready`
// refuses files above the framework's size limit.
function attach(file) {
  return props.uploader.upload_file({ file_obj: file, name: file.name, private: isPrivate.value })
}

async function readContent(row) {
  const res = await fetch(`${DRIVE}/nodes/${encodeURIComponent(row.name)}/content`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(await errorMessage(res, __('Could not read this file from Drive')))
  const blob = await res.blob()
  return new File([blob], row.title, { type: row.mime || blob.type })
}

// Drive's three upload routes: open a session, send the bytes, finish into `parent`.
async function driveUpload(file, parent) {
  const session = await drive('POST', 'uploads', {
    body: { parent, filename: file.name, size: file.size, mime: file.type || undefined },
  })
  const id = encodeURIComponent(session.upload_id)
  if (session.mode === 'direct') {
    const form = new FormData()
    for (const [key, value] of Object.entries(session.fields || {})) form.append(key, value)
    form.append('file', file)
    const res = await fetch(session.url, { method: 'POST', body: form })
    if (!res.ok) throw new Error(__('Could not upload to Drive'))
  } else {
    // One chunk at least, so an empty file still finishes.
    let offset = 0
    do {
      await drive('PUT', `uploads/${id}/chunk`, { query: { offset }, raw: file.slice(offset, offset + CHUNK) })
      offset += CHUNK
    } while (offset < file.size)
  }
  return drive('POST', `uploads/${id}/finish`, { body: { parent, title: file.name } })
}

async function drive(method, path, { query, body, raw } = {}) {
  const url = new URL(`${DRIVE}/${path}`, window.location.origin)
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }
  const headers = { Accept: 'application/json', 'X-Frappe-CSRF-Token': frappe.csrf_token }
  if (body) headers['Content-Type'] = 'application/json; charset=utf-8'
  if (raw) headers['Content-Type'] = 'application/octet-stream'
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  })
  if (!res.ok) throw new Error(await errorMessage(res, __('Drive could not complete the request')))
  const data = await res.json().catch(() => null)
  return data && 'data' in data ? data.data : data
}

async function errorMessage(res, fallback) {
  const data = await res.json().catch(() => null)
  const first = Array.isArray(data?.errors) ? data.errors[0] : data?.error
  return (typeof first?.message === 'string' && first.message) || fallback
}

defineExpose({ submit })
</script>

<style scoped>
.drive-picker {
  display: flex;
  flex-direction: column;
  font-size: var(--text-base);
  color: var(--ink-gray-8);
}

:global(.drive-library-dialog .modal-body) {
  padding-top: 0.5rem;
}

/* Tabs */
.tab-bar {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--outline-gray-1, #e5e5e5);
}

.tab {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  border-bottom: 1.5px solid transparent;
  padding: 0.5rem 0.25rem;
  margin-right: 0.75rem;
  font-size: var(--text-sm);
  color: var(--ink-gray-5);
  cursor: pointer;
}

.tab.active {
  color: var(--ink-gray-9);
  border-bottom-color: var(--ink-gray-9);
  font-weight: 500;
}

.tab-icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
}




/* Search */
.search {
  margin-top: 0.75rem;
  font-size: var(--text-sm);
  height: 1.85rem;
  border: 1px solid var(--outline-gray-2, #e0e0e0);
  border-radius: var(--border-radius, 8px);
  background: var(--surface-gray-2);
  padding: 0 0.6rem;
  width: 100%;
}

.search:focus {
  outline: none;
  background: var(--surface-white, #fff);
  border-color: var(--outline-gray-3, #b3b3b3);
}

/* Breadcrumbs */
.crumbs {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  gap: 0.15rem;
  padding: 0.6rem 0 0.4rem;
}

.crumb {
  background: none;
  border: none;
  padding: 0.1rem 0.3rem;
  border-radius: 6px;
  font-size: var(--text-sm);
  color: var(--ink-gray-5);
  cursor: pointer;
  white-space: nowrap;
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crumb:hover {
  background: var(--surface-gray-2);
}

.crumb.last {
  color: var(--ink-gray-8);
  font-weight: 500;
}

.crumb-sep {
  color: var(--ink-gray-4, #c4c4c4);
  font-size: var(--text-sm);
}

/* List */
.list {
  height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.state {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
}

.muted {
  color: var(--ink-gray-5);
  font-size: var(--text-sm);
}

.file-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  margin: 0;
  padding: 0.4rem 0.5rem;
  border-radius: var(--border-radius, 8px);
  cursor: pointer;
  color: var(--ink-gray-8);
}

.file-row:hover {
  background: var(--surface-gray-2);
}

.file-row.selected {
  background: var(--surface-gray-3);
}

.row-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  object-fit: contain;
}

.row-name {
  flex: 1;
  font-size: var(--text-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-chevron {
  width: 14px;
  height: 14px;
  color: var(--ink-gray-4, #c4c4c4);
  flex-shrink: 0;
  display: inline-flex;
}

/* Footer */
.footer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-top: 1px solid var(--outline-gray-1, #e5e5e5);
  padding-top: 0.75rem;
  margin-top: 0.25rem;
}

.footer-info {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--ink-gray-5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-error {
  color: var(--ink-red-4, #e03636);
}

.private-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-gray-7);
  cursor: pointer;
}

.private-toggle input {
  margin: 0;
}

.footer-info b {
  color: var(--ink-gray-8);
  font-weight: 500;
}

.hidden {
  display: none;
}

.ghost-btn,
.primary-btn {
  font-size: var(--text-sm);
  height: 1.75rem;
  padding: 0 0.75rem;
  border-radius: var(--border-radius, 8px);
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.ghost-btn {
  background: var(--surface-gray-2);
  color: var(--ink-gray-8);
}

.ghost-btn:hover {
  background: var(--surface-gray-3);
}

.primary-btn {
  background: var(--surface-gray-7, #383838);
  color: var(--ink-white, #fff);
}

.primary-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
