<template>
  <Dialog v-model="show" :options="{ title: dialogTitle, size: 'md' }">
    <template #body-content>

      <!-- Inline error banner for permission / network failures from any of
           the share endpoints. Auto-clears after 5 s. -->
      <Badge
        v-if="errorMessage"
        theme="red" variant="subtle" size="sm"
        class="sd-error"
        :label="errorMessage"
        :tooltip="errorMessage"
      />

      <!-- ── General Access ────────────────────────────────────────────────── -->
      <p class="sd-label">General Access</p>
      <div class="sd-access-row">
        <Dropdown :options="generalAccessOpts" placement="bottom-start">
          <template #default>
            <Button
              variant="outline"
              size="sm"
              :iconLeft="generalAccess === 'all' ? 'globe' : 'lock'"
              iconRight="chevron-down"
              :label="generalAccess === 'all' ? 'Accessible to all' : 'Restricted'"
              class="sd-pill-btn"
            />
          </template>
        </Dropdown>

        <Dropdown v-if="generalAccess === 'all'" :options="generalRoleOpts" placement="bottom-end">
          <template #default>
            <Button
              variant="outline"
              size="sm"
              icon-left="eye"
              icon-right="chevron-down"
              :label="generalRole === '1' ? 'Can edit' : 'Can view'"
              class="sd-pill-btn"
            />
          </template>
        </Dropdown>
      </div>

      <div class="sd-divider" />

      <!-- ── Members ────────────────────────────────────────────────────────── -->
      <p class="sd-label">Members</p>

      <!-- Stage row: chips for users pending invite + free-text search input
           on the left; the role dropdown on the right applies to the whole
           batch on Invite. Drive-style — nothing commits until the user
           clicks "Invite" in the actions row. -->
      <div class="sd-stage-row">
        <div class="sd-stage-wrap sd-search-wrap" :class="{ 'sd-stage-wrap--has-chips': staged.length }">
          <div v-for="(c, i) in staged" :key="c.user" class="sd-chip">
            <Avatar :label="c.initials" :image="c.user_image || undefined" size="xs" />
            <span class="sd-chip-text">{{ c.user }}</span>
            <button
              type="button"
              class="sd-chip-x"
              aria-label="Remove"
              @click.stop="removeChip(i)"
            >×</button>
          </div>
          <input
            v-model="searchQuery"
            type="text"
            class="sd-stage-input"
            :placeholder="staged.length ? '' : 'Add people...'"
            autocomplete="off"
            @input="e => onSearchInput(e.target.value)"
            @keydown.backspace="onStageBackspace"
          />
          <div v-if="searchResults.length" class="sd-results">
            <button
              v-for="u in searchResults"
              :key="u.name"
              class="sd-result-row"
              @mousedown.prevent="addChip(u)"
            >
              <Avatar :label="u.initials" :image="u.user_image || undefined" size="sm" />
              <div class="sd-result-info">
                <span class="sd-result-name">{{ u.full_name }}</span>
                <span class="sd-result-email">{{ u.name }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Role for the staged batch — shown only when there is something
             to invite, mirroring Drive's behaviour. -->
        <Dropdown v-if="staged.length" :options="pendingRoleOpts" placement="bottom-end">
          <template #default>
            <Button
              variant="outline"
              size="sm"
              icon-left="eye"
              icon-right="chevron-down"
              :label="pendingRole === '1' ? 'Can edit' : 'Can view'"
              class="sd-pill-btn"
            />
          </template>
        </Dropdown>
      </div>

      <!-- Member list -->
      <div v-if="loading" class="sd-loading"><Spinner size="sm" /></div>
      <div v-else class="sd-member-list">
        <!-- Owner always first -->
        <div class="sd-member-row">
          <Avatar :label="ownerInitials" :image="ownerImage || undefined" size="md" :tooltip="ownerFullName" />
          <div class="sd-member-info">
            <span class="sd-member-name">{{ ownerFullName }}</span>
            <span v-if="props.ownerId !== ownerFullName" class="sd-member-email">{{ props.ownerId }}</span>
          </div>
          <span class="sd-role-label">{{ _ownerIsMe ? 'Owner (you)' : 'Owner' }}</span>
        </div>

        <div v-for="s in shares" :key="s.user" class="sd-member-row">
          <Avatar :label="s.initials" :image="s.user_image || undefined" size="md" :tooltip="s.full_name" />
          <div class="sd-member-info">
            <span class="sd-member-name">{{ s.full_name }}</span>
            <span class="sd-member-email">{{ s.user }}</span>
          </div>
          <Dropdown :options="memberRoleOpts(s)" placement="bottom-end">
            <template #default>
              <Button
                variant="ghost"
                size="sm"
                :label="s.write ? 'Can edit' : 'Can view'"
                icon-right="chevron-down"
              />
            </template>
          </Dropdown>
        </div>

        <p v-if="!shares.length" class="sd-empty">No one else has access yet.</p>
      </div>

    </template>

    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button
          variant="solid"
          size="sm"
          label="Invite"
          :loading="inviting"
          :disabled="!staged.length || inviting"
          @click="inviteStaged"
        />
        <Button variant="outline" size="sm" icon-left="link-2" label="Copy link" @click="copyLink" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Badge, Button, Dialog, Spinner, Dropdown, Avatar } from 'frappe-ui'
import { call } from '../../utils/api.js'
import { useCurrentUser } from '@/boot/session'
import { userInitials } from '../../utils/session.js'

const props = defineProps({
  modelValue:  { type: Boolean, default: false },
  sheetId:     { type: String,  default: '' },
  sheetTitle:  { type: String,  default: '' },
  ownerId:     { type: String,  default: '' },
})
const emit = defineEmits(['update:modelValue', 'shares-changed'])

// ── open/close ─────────────────────────────────────────────────────────────

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const dialogTitle = computed(() => `Sharing "${props.sheetTitle || 'Untitled Sheet'}"`)

watch(show, (open) => {
  if (open) {
    errorMessage.value = ''
    staged.value      = []
    pendingRole.value = '0'
    searchQuery.value = ''
    searchResults.value = []
    fetchShares()
    fetchOwnerInfo()
  }
})

// ── inline error banner ──────────────────────────────────────────────────
//
// Every share endpoint can fail with PermissionError (e.g. a read-only
// member trying to add or remove someone else). Without surfacing the
// failure the optimistic UI revert just makes things "snap back" with no
// explanation. Auto-clear after 5 s so the banner doesn't linger after
// the user has read it.
const errorMessage = ref('')
function _flashError(err) {
  const msg = (err && err.message) ? String(err.message) : 'Something went wrong'
  errorMessage.value = msg
  setTimeout(() => { if (errorMessage.value === msg) errorMessage.value = '' }, 5000)
}

// ── owner ──────────────────────────────────────────────────────────────────

const currentUser = useCurrentUser()

// A read-only member can open this dialog for a sheet they don't own (see the
// error-banner note below), so the owner is often *not* the current user. When
// it is, read the name/image from the shared session store; otherwise fetch the
// owner's User record — the same way the invite autocomplete resolves people —
// so the owner row shows a real name instead of the raw email.
const ownerInfo = ref(null)   // { full_name, user_image } for a non-self owner
async function fetchOwnerInfo() {
  ownerInfo.value = null
  if (!props.ownerId || props.ownerId === currentUser.user.value) return
  try {
    ownerInfo.value = await call('frappe.client.get_value', {
      doctype: 'User', filters: props.ownerId, fieldname: ['full_name', 'user_image'],
    })
  } catch (_) { /* fall back to the id below */ }
}

const _ownerIsMe = computed(() => !!props.ownerId && props.ownerId === currentUser.user.value)
const ownerFullName = computed(() =>
  (_ownerIsMe.value && currentUser.fullName.value)
  || ownerInfo.value?.full_name
  || props.ownerId
  || 'You'
)
const ownerImage = computed(() =>
  (_ownerIsMe.value ? currentUser.imageURL.value : ownerInfo.value?.user_image) || ''
)
const ownerInitials = computed(() => userInitials(ownerFullName.value, props.ownerId))

// ── general access ─────────────────────────────────────────────────────────

const generalAccess = ref('restricted')
const generalRole   = ref('0')

const generalAccessOpts = computed(() => [
  { label: 'Restricted',        onClick: () => applyGeneralAccess('restricted') },
  { label: 'Accessible to all', onClick: () => applyGeneralAccess('all') },
])
const generalRoleOpts = computed(() => [
  { label: 'Can view', onClick: () => { generalRole.value = '0'; applyGeneralAccess('all') } },
  { label: 'Can edit', onClick: () => { generalRole.value = '1'; applyGeneralAccess('all') } },
])

async function applyGeneralAccess(type) {
  const prevAccess = generalAccess.value
  generalAccess.value = type
  if (!props.sheetId) return
  try {
    if (type === 'all') {
      await call('suite.sheets.api.share_sheet', {
        name: props.sheetId, everyone: 1, write: generalRole.value === '1' ? 1 : 0,
      })
    } else {
      await call('suite.sheets.api.unshare_sheet', { name: props.sheetId, everyone: 1 })
    }
  } catch (err) {
    generalAccess.value = prevAccess   // revert visual state
    _flashError(err)
  }
}

// ── shares ─────────────────────────────────────────────────────────────────

const loading = ref(false)
const shares  = ref([])

async function fetchShares() {
  if (!props.sheetId) return
  loading.value = true
  try {
    const rows = await call('suite.sheets.api.get_sheet_shares', { name: props.sheetId })
    // The "everyone" row encodes general access; keep it out of the member
    // list and use it to seed the General Access dropdown so the dialog
    // reflects persisted state on re-open.
    const everyoneRow = rows.find(r => r.everyone)
    if (everyoneRow) {
      generalAccess.value = 'all'
      generalRole.value   = everyoneRow.write ? '1' : '0'
    } else {
      generalAccess.value = 'restricted'
    }
    shares.value = rows
      .filter(r => !r.everyone && r.user !== props.ownerId)
      .map(r => ({ ...r, write: !!r.write }))
    emit('shares-changed', shares.value.length)
  } catch (err) {
    _flashError(err)
  }
  finally { loading.value = false }
}

function memberRoleOpts(s) {
  return [
    { label: 'Can view',      onClick: () => changeRole(s, false) },
    { label: 'Can edit',      onClick: () => changeRole(s, true)  },
    { label: 'Remove access', onClick: () => removeShare(s)       },
  ]
}

async function changeRole(s, write) {
  const prev = s.write; s.write = write
  try {
    await call('suite.sheets.api.share_sheet', {
      name: props.sheetId, user: s.user, write: write ? 1 : 0,
    })
  } catch (err) {
    s.write = prev
    _flashError(err)
  }
}

async function removeShare(s) {
  shares.value = shares.value.filter(r => r.user !== s.user)
  emit('shares-changed', shares.value.length)
  try {
    await call('suite.sheets.api.unshare_sheet', { name: props.sheetId, user: s.user })
  } catch (err) {
    _flashError(err)
    await fetchShares()
  }
}

// ── search ─────────────────────────────────────────────────────────────────

const searchQuery   = ref('')
const searchResults = ref([])
let   _searchTimer  = null

function onSearchInput(val) {
  clearTimeout(_searchTimer)
  const q = (val || '').trim()
  if (q.length < 2) { searchResults.value = []; return }
  _searchTimer = setTimeout(() => searchUsers(q), 250)
}

async function searchUsers(q) {
  try {
    const rows = await call('frappe.client.get_list', {
      doctype: 'User',
      filters: [
        ['enabled', '=', 1],
        ['user_type', '=', 'System User'],
        ['name', '!=', props.ownerId],
        ['full_name', 'like', `%${q}%`],
      ],
      fields: ['name', 'full_name', 'user_image'],
      limit: 6,
    })
    // Exclude both existing members and users already staged as chips so
    // the same person can't be added twice.
    const existing = new Set([
      ...shares.value.map(s => s.user),
      ...staged.value.map(c => c.user),
    ])
    searchResults.value = rows
      .filter(r => !existing.has(r.name))
      .map(r => ({
        ...r,
        initials: r.full_name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase(),
      }))
  } catch (_) { searchResults.value = [] }
}

// ── chip staging ───────────────────────────────────────────────────────────
//
// Drive's UX: search results add a *chip* to the input rather than committing
// the share. The user can stage several people, pick a single role for the
// batch, and click "Invite" to fan out share_sheet calls in one go. This
// reduces notification noise (each invitee gets one email instead of N)
// and makes the role choice deliberate.

const staged      = ref([])         // [{ user, full_name, user_image, initials }]
const pendingRole = ref('0')        // '0' = Can view, '1' = Can edit
const inviting    = ref(false)

const pendingRoleOpts = computed(() => [
  { label: 'Can view', onClick: () => { pendingRole.value = '0' } },
  { label: 'Can edit', onClick: () => { pendingRole.value = '1' } },
])

function addChip(u) {
  staged.value.push({
    user: u.name, full_name: u.full_name, user_image: u.user_image, initials: u.initials,
  })
  searchQuery.value   = ''
  searchResults.value = []
}

function removeChip(i) { staged.value.splice(i, 1) }

// Backspace in an empty input pops the last chip — small ergonomic win
// users expect from chip-style inputs (Gmail, Drive, Linear, etc.).
function onStageBackspace(e) {
  if (!searchQuery.value && staged.value.length) {
    e.preventDefault()
    staged.value.pop()
  }
}

async function inviteStaged() {
  if (!staged.value.length || inviting.value) return
  inviting.value = true
  const write = pendingRole.value === '1' ? 1 : 0
  const failed = []
  try {
    // Sequential rather than Promise.all so a single failure surfaces a
    // useful per-user error message instead of getting drowned by a
    // hard-to-read aggregate rejection.
    for (const c of staged.value) {
      try {
        await call('suite.sheets.api.share_sheet', { name: props.sheetId, user: c.user, write })
      } catch (err) {
        failed.push({ chip: c, err })
      }
    }
    // Keep the chips that failed so the user can see what didn't go
    // through; drop the successful ones.
    staged.value = failed.map(f => f.chip)
    if (failed.length) {
      _flashError(failed[0].err)
    }
    await fetchShares()
  } finally {
    inviting.value = false
  }
}

async function copyLink() {
  try { await navigator.clipboard.writeText(window.location.href) } catch (_) {}
}
</script>

<style scoped>
/* Inline error banner — sits above the dialog body for permission / network
   failures from any of the share endpoints. */
.sd-error { display: block; margin: 0 0 12px; max-width: 100%; }

/* ── Labels ── */
.sd-label {
  font-size: 13px; font-weight: 500; color: var(--ink-gray-6);
  margin: 0 0 10px; letter-spacing: .01em;
}

/* ── General access row ── */
.sd-access-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 4px;
}

/* Make Frappe UI Button pill-shaped inside the access row */
.sd-pill-btn :deep(button) { border-radius: 999px; }

/* ── Divider ── */
.sd-divider { height: 1px; background: var(--outline-gray-1); margin: 16px 0; }

/* ── Stage row (chips + input + role) ── */
.sd-stage-row {
  display: flex; align-items: flex-start; gap: 8px; margin-bottom: 4px;
}

/* Pill-shaped wrapper holds the chips inline with the free-text input.
   Background and focus styling mimic the prior FormControl-based search
   so existing visual language is preserved. */
.sd-stage-wrap {
  flex: 1; min-width: 0; position: relative;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 6px 12px;
  background: var(--surface-gray-2);
  border: 1px solid transparent;
  border-radius: 18px;
  transition: background-color .1s, border-color .1s;
}
.sd-stage-wrap:hover        { background: var(--surface-gray-3); }
.sd-stage-wrap:focus-within { background: var(--surface-gray-3); }

/* When chips are present, give the wrapper a touch more vertical padding
   so the chips don't kiss the edge. */
.sd-stage-wrap--has-chips { padding: 5px 8px; }

.sd-stage-input {
  flex: 1; min-width: 80px;
  border: 0; background: transparent;
  font-size: 13px; color: var(--ink-gray-9);
  padding: 2px 4px;
}
/* Belt-and-braces: some global styles (frappe-ui, browser default) add a
   blue outline/box-shadow on focused inputs — strip them so only our
   wrapper background communicates focus. */
.sd-stage-input:focus,
.sd-stage-input:focus-visible { outline: none !important; box-shadow: none !important; }
.sd-stage-input::placeholder { color: var(--ink-gray-5); }

/* Individual chip pill */
.sd-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--surface-base);
  border: 1px solid var(--outline-gray-2);
  border-radius: 999px;
  padding: 2px 6px 2px 4px;
  font-size: 12px; color: var(--ink-gray-8);
  max-width: 240px;
}
.sd-chip-text {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 180px;
}
.sd-chip-x {
  border: 0; background: transparent; cursor: pointer;
  font-size: 14px; line-height: 1; color: var(--ink-gray-5);
  padding: 0 2px; border-radius: 4px;
}
.sd-chip-x:hover { color: var(--ink-gray-8); background: var(--surface-gray-2); }

/* Generic search-wrap class kept so the absolute-positioned results
   popover continues to anchor correctly. */
.sd-search-wrap { position: relative; }

/* Search results popover */
.sd-results {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 500;
  background: var(--surface-elevation-2); border: 1px solid var(--outline-elevation-2);
  border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.12); padding: 4px;
}
.sd-result-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px; width: 100%;
  border-radius: 6px; border: none; background: transparent; cursor: pointer; text-align: left;
  transition: background-color .1s;
}
.sd-result-row:hover { background: var(--surface-gray-2); }
.sd-result-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.sd-result-name  { font-size: 13px; font-weight: 500; color: var(--ink-gray-9); }
.sd-result-email { font-size: 11px; color: var(--ink-gray-5); }

/* ── Member list ── */
.sd-loading      { display: flex; justify-content: center; padding: 20px; }
.sd-member-list  { display: flex; flex-direction: column; margin-top: 8px; }
.sd-member-row   {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 4px; border-radius: 8px; transition: background-color .1s;
}
.sd-member-row:hover { background: var(--surface-gray-1); }
.sd-member-info  { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; overflow: hidden; }
.sd-member-name  { font-size: 13px; font-weight: 600; color: var(--ink-gray-9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sd-member-email { font-size: 11px; color: var(--ink-gray-5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sd-role-label   { font-size: 12px; color: var(--ink-gray-5); flex-shrink: 0; white-space: nowrap; padding-right: 4px; }
.sd-empty        { font-size: 13px; color: var(--ink-gray-5); padding: 12px 4px; margin: 0; }
</style>
