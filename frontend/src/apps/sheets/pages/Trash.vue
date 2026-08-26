<template>
  <div class="home">
    <!-- Top bar — mirrors Home's chrome, minus search/view-toggle/New. -->
    <div class="home-topbar">
      <div class="home-brand">
        <Button variant="ghost" size="sm" icon="lucide-arrow-left" tooltip="Back to sheets" @click="goHome()" />
        <span class="home-brand-name">Trash</span>
      </div>
      <div class="home-topbar-right">
        <Badge v-if="errorMessage" theme="red" variant="subtle" size="sm" :label="errorMessage" />
        <span class="home-trash-note">Items are deleted forever after {{ retentionDays }} days</span>
      </div>
    </div>

    <div class="home-body">
      <div v-if="loading" class="home-empty">
        <Spinner class="home-spinner" />
      </div>

      <div v-else-if="!sheets.length" class="home-empty">
        <div class="home-empty-icon">
          <FeatherIcon name="trash-2" class="home-trash-empty-icon" />
        </div>
        <p class="home-empty-title">Trash is empty</p>
        <p class="home-empty-sub">Deleted sheets show up here.</p>
      </div>

      <ListView
        v-else
        :columns="listColumns"
        :rows="sheets"
        row-key="name"
        :options="listOptions"
      >
        <template #cell="{ item, row, column }">
          <div
            v-if="column.key === '_actions'"
            class="flex w-full justify-end gap-1"
            @click.stop
          >
            <Button variant="ghost" size="sm" :loading="busy === row.name" @click="restore(row)">Restore</Button>
            <Button variant="ghost" theme="red" size="sm" :loading="busy === row.name" @click="confirmPurge(row)">Delete forever</Button>
          </div>
          <ListRowItem v-else :column="column" :row="row" :item="item" :align="column.align" />
        </template>
      </ListView>
    </div>

    <!-- Permanent delete confirm -->
    <Dialog v-model:open="showPurgeDialog" title="Delete forever?" size="sm">
      <template #default>
        <p class="home-confirm-text">
          "<strong>{{ purgeTarget?.title }}</strong>" and its full history will be
          <strong>permanently deleted</strong>. This can't be undone.
        </p>
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button variant="solid" theme="red" :loading="purging" @click="doPurge">Delete forever</Button>
          <Button @click="showPurgeDialog = false">Cancel</Button>
        </div>
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Badge, Button, Dialog, Spinner } from 'frappe-ui'
import { Icon as FeatherIcon, ListView, ListRowItem } from 'frappe-ui/experimental'
import { useRouter } from 'vue-router'

import { call } from '@/apps/sheets/utils/api.js'

const router = useRouter()

const sheets  = ref([])
const loading = ref(true)
const busy    = ref('')   // name of the row with an in-flight restore/purge
const retentionDays = ref(30)

const errorMessage = ref('')
function _flashError(msg) {
  errorMessage.value = msg
  setTimeout(() => { if (errorMessage.value === msg) errorMessage.value = '' }, 4000)
}

function goHome() {
  router.push({ name: 'sheets-home' })
}

const listColumns = [
  { label: 'Name', key: 'title', width: 3 },
  { label: 'Trashed', key: 'trashed_on', width: 1, getLabel: ({ row }) => formatDate(row.trashed_on) },
  { label: '', key: '_actions', width: '220px', align: 'right' },
]

const listOptions = { selectable: false, showTooltip: false, rowHeight: 40 }

onMounted(fetchTrash)

async function fetchTrash() {
  loading.value = true
  try {
    const res = await call('suite.sheets.api.list_trash')
    sheets.value = res.sheets ?? []
    if (res.retention_days) retentionDays.value = res.retention_days
  } finally {
    loading.value = false
  }
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso.replace(' ', 'T'))
  return d.toLocaleDateString()
}

async function restore(sheet) {
  busy.value = sheet.name
  try {
    await call('suite.sheets.api.restore_sheet', { name: sheet.name })
    sheets.value = sheets.value.filter(s => s.name !== sheet.name)
  } catch (err) {
    _flashError(err?.message || 'Restore failed')
  } finally {
    busy.value = ''
  }
}

const showPurgeDialog = ref(false)
const purgeTarget     = ref(null)
const purging         = ref(false)

function confirmPurge(sheet) {
  purgeTarget.value = sheet
  showPurgeDialog.value = true
}

async function doPurge() {
  if (!purgeTarget.value) return
  purging.value = true
  try {
    await call('suite.sheets.api.delete_sheet_permanent', { name: purgeTarget.value.name })
    sheets.value = sheets.value.filter(s => s.name !== purgeTarget.value.name)
    showPurgeDialog.value = false
  } catch (err) {
    _flashError(err?.message || 'Delete failed')
  } finally {
    purging.value = false
  }
}
</script>

<style scoped>
/* Reuses Home.vue's class names for the shared shell (.home, .home-topbar,
   .home-body, .home-empty, .home-confirm-text) — those live in Home's scoped
   block, so the shared bits are duplicated here to keep this page standalone. */
.home {
  display: flex;
  flex-direction: column;
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
.home-brand { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.home-brand-name { font-size: 16px; font-weight: 600; letter-spacing: .01em; color: var(--ink-gray-9); }
.home-topbar-right { display: flex; align-items: center; gap: 16px; margin-left: auto; }
.home-trash-note { font-size: 12px; letter-spacing: .02em; color: var(--ink-gray-5); }
.home-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 40px 32px;
  width: 100%;
}
.home-body > * { max-width: 1200px; margin-left: auto; margin-right: auto; }
.home-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 300px;
  color: var(--ink-gray-5);
}
.home-spinner { width: 32px; height: 32px; color: var(--ink-gray-5); }
.home-empty-icon { margin-bottom: 4px; }
.home-trash-empty-icon { width: 40px; height: 40px; color: var(--ink-gray-4); }
.home-empty-title { font-size: 15px; font-weight: 500; letter-spacing: .01em; color: var(--ink-gray-8); margin: 0; }
.home-empty-sub { font-size: 13px; letter-spacing: .02em; color: var(--ink-gray-5); margin: 0 0 8px; }
.home-confirm-text { font-size: 14px; letter-spacing: .02em; color: var(--ink-gray-7); margin: 0; }
</style>
