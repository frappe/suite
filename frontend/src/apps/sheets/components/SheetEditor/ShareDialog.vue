<template>
  <Dialog v-model:open="show" :title="dialogTitle" size="lg">
    <template #default>

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
      <!-- Mirrors Frappe Writer / Drive: two frappe-ui Selects side by side
           (access level + role) so the whole dialog speaks one consistent
           control + typography language instead of a mix of pills and badges. -->
      <p class="sd-section-label">General Access</p>
      <div class="flex items-center justify-between gap-2">
        <Select
          :model-value="generalAccess"
          :options="generalAccessOptions"
          size="sm"
          @update:model-value="onGeneralLevel"
        />
        <Select
          v-if="generalAccess === 'all'"
          :model-value="generalRole"
          :options="generalRoleOptions"
          size="sm"
          @update:model-value="onGeneralRole"
        />
      </div>

      <div class="sd-divider" />

      <!-- ── Members ────────────────────────────────────────────────────────── -->
      <p class="sd-section-label">Members</p>

      <!-- Stage row: chips for users pending invite + free-text search input
           on the left; the role Select on the right applies to the whole
           batch on Invite. Drive-style — nothing commits until the user
           clicks "Invite" in the actions row. -->
      <div class="flex items-start gap-2">
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
            aria-label="Add people"
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
                <span class="sd-primary-text">{{ u.full_name }}</span>
                <span class="sd-secondary-text">{{ u.name }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Role for the staged batch — shown only when there is something
             to invite, mirroring Drive's behaviour. -->
        <Select
          v-if="staged.length"
          v-model="pendingRole"
          :options="pendingRoleOptions"
          size="sm"
        />
      </div>

      <!-- Member list -->
      <div v-if="loading" class="sd-loading"><Spinner size="sm" /></div>
      <div v-else class="sd-member-list">
        <!-- Owner always first -->
        <div class="sd-member-row">
          <Avatar :label="ownerInitials" :image="ownerImage || undefined" size="lg" :tooltip="ownerFullName" />
          <div class="sd-member-info">
            <span class="sd-primary-text">{{ ownerFullName }}</span>
            <span v-if="props.ownerId !== ownerFullName" class="sd-secondary-text">{{ props.ownerId }}</span>
          </div>
          <span class="sd-role-static">{{ _ownerIsMe ? 'Owner (you)' : 'Owner' }}</span>
        </div>

        <div v-for="s in shares" :key="s.user" class="sd-member-row">
          <Avatar :label="s.initials" :image="s.user_image || undefined" size="lg" :tooltip="s.full_name" />
          <div class="sd-member-info">
            <span class="sd-primary-text">{{ s.full_name }}</span>
            <span class="sd-secondary-text">{{ s.user }}</span>
          </div>
          <div class="shrink-0">
            <Select
              :model-value="s.write ? '1' : '0'"
              :options="memberRoleOptions"
              size="sm"
              @update:model-value="v => onMemberRole(s, v)"
            />
          </div>
        </div>
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
        <Button variant="outline" size="sm" icon-left="lucide-link-2" label="Copy link" @click="copyLink" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Badge, Button, Dialog, Spinner, Avatar, Select } from 'frappe-ui'
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

// get_sheet can resolve *after* the dialog is already open — a fast click on
// Share before the sheet finishes loading opens it with ownerId still the
// current viewer, then ownerId flips to the real owner once load lands. Re-run
// the owner-profile lookup (so the row shows the real name/avatar, not a raw
// email) and re-filter the member list, which keys off ownerId too.
watch(() => props.ownerId, () => {
  if (show.value) {
    fetchOwnerInfo()
    fetchShares()
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
// error-banner note above), so the owner is often *not* the current user. When
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
//
// Org-wide access is a DocShare `everyone` row (share_sheet everyone=1 / unshare
// everyone=1), seeded from get_sheet_shares on open. Two Selects: the level
// (Restricted / Accessible to all) and, when public, the role (view / edit).

const generalAccess = ref('restricted')   // 'restricted' | 'all'
const generalRole   = ref('0')            // '0' = Can view, '1' = Can edit

const generalAccessOptions = [
  { label: 'Restricted',        value: 'restricted', icon: 'lucide-lock' },
  { label: 'Accessible to all', value: 'all',        icon: 'lucide-globe' },
]
const generalRoleOptions = [
  { label: 'Can view', value: '0', icon: 'lucide-eye' },
  { label: 'Can edit', value: '1', icon: 'lucide-pencil' },
]

// Serializes the two general-access handlers so a rapid restricted→all toggle
// can't read a stale `generalRole` and silently re-grant edit the user had
// just revoked.
const _persistingAccess = ref(false)

async function _persistGeneral(access, role) {
  if (access === 'all') {
    await call('suite.sheets.api.share_sheet', {
      name: props.sheetId, everyone: 1, write: role === '1' ? 1 : 0,
    })
  } else {
    await call('suite.sheets.api.unshare_sheet', { name: props.sheetId, everyone: 1 })
  }
}

async function onGeneralLevel(type) {
  if (_persistingAccess.value || type === generalAccess.value) return
  const prevAccess = generalAccess.value
  const prevRole   = generalRole.value
  _persistingAccess.value = true
  // Going public always starts view-only; the edit scope is a deliberate
  // second step, so the persisted write never depends on a stale role.
  generalAccess.value = type
  generalRole.value   = '0'
  try {
    if (props.sheetId) await _persistGeneral(type, '0')
  } catch (err) {
    generalAccess.value = prevAccess   // revert visual state
    generalRole.value   = prevRole
    _flashError(err)
  } finally {
    _persistingAccess.value = false
  }
}

async function onGeneralRole(role) {
  if (_persistingAccess.value || role === generalRole.value) return
  const prev = generalRole.value
  _persistingAccess.value = true
  generalRole.value = role
  try {
    if (props.sheetId) await _persistGeneral('all', role)
  } catch (err) {
    generalRole.value = prev            // revert visual state
    _flashError(err)
  } finally {
    _persistingAccess.value = false
  }
}

// ── shares ─────────────────────────────────────────────────────────────────

const loading = ref(false)
const shares  = ref([])

const memberRoleOptions = [
  { label: 'Can view',      value: '0',      icon: 'lucide-eye' },
  { label: 'Can edit',      value: '1',      icon: 'lucide-pencil' },
  { label: 'Remove access', value: 'remove', icon: 'lucide-trash-2' },
]

async function fetchShares() {
  if (!props.sheetId) return
  loading.value = true
  try {
    const rows = await call('suite.sheets.api.get_sheet_shares', { name: props.sheetId })
    // The "everyone" row encodes general access; keep it out of the member
    // list and use it to seed the General Access Selects so the dialog
    // reflects persisted state on re-open.
    const everyoneRow = rows.find(r => r.everyone)
    if (everyoneRow) {
      generalAccess.value = 'all'
      generalRole.value   = everyoneRow.write ? '1' : '0'
    } else {
      generalAccess.value = 'restricted'
      generalRole.value   = '0'
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

function onMemberRole(s, val) {
  if (val === 'remove') return removeShare(s)
  changeRole(s, val === '1')
}

async function changeRole(s, write) {
  // `write` is a boolean (from `val === '1'`); normalise s.write too so the
  // no-op guard is correct regardless of how the share row was shaped.
  if (Boolean(s.write) === write) return
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

const pendingRoleOptions = [
  { label: 'Can view', value: '0', icon: 'lucide-eye' },
  { label: 'Can edit', value: '1', icon: 'lucide-pencil' },
]

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
/* ── Type scale ──────────────────────────────────────────────────────────────
   The whole dialog speaks three text styles, differentiated by weight + colour
   rather than a spread of pixel sizes (this was the founder's "so many different
   font styles" note). The metrics mirror frappe-ui's own text tokens exactly —
   line-height 1.15, letter-spacing 0.02em, regular weight 420 (InterVar) — so
   this text tracks identically to the Dialog title, Selects and Buttons around
   it (there's no compound `text-*-medium` class to reuse, and `text-base` +
   `font-medium` utilities fight over weight, so we set it here). */
.sd-section-label {                 /* "General Access", "Members" */
  font-size: 13px; font-weight: 500; letter-spacing: 0.02em; line-height: 1.15;
  color: var(--ink-gray-5); margin: 0 0 12px;
}
.sd-primary-text {                  /* people's names */
  font-size: 14px; font-weight: 500; letter-spacing: 0.02em; line-height: 1.15;
  color: var(--ink-gray-8);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sd-secondary-text,                 /* emails */
.sd-role-static {                   /* "Owner (you)" */
  font-size: 13px; font-weight: 420; letter-spacing: 0.02em; line-height: 1.15;
  color: var(--ink-gray-6);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Inline error banner — sits above the dialog body for permission / network
   failures from any of the share endpoints. */
.sd-error { display: block; margin: 0 0 12px; max-width: 100%; }

/* ── Divider ── */
.sd-divider { height: 1px; background: var(--outline-gray-1); margin: 20px 0; }

/* ── Stage row (chips + input) ── */
/* Pill-shaped wrapper holds the chips inline with the free-text input.
   Background and focus styling mimic the prior FormControl-based search
   so existing visual language is preserved. */
.sd-stage-wrap {
  flex: 1; min-width: 0; position: relative;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 6px 12px;
  background: var(--surface-gray-2);
  border: 1px solid transparent;
  border-radius: 8px;
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
  font-size: 13px; letter-spacing: 0.02em; color: var(--ink-gray-9);
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
  font-size: 13px; letter-spacing: 0.02em; color: var(--ink-gray-8);
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

/* ── Member list ── */
.sd-loading      { display: flex; justify-content: center; padding: 20px; }
.sd-member-list  { display: flex; flex-direction: column; margin-top: 12px; }
.sd-member-row   {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 4px; border-radius: 8px; transition: background-color .1s;
}
.sd-member-row:hover { background: var(--surface-gray-1); }
.sd-member-info  { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; overflow: hidden; }
.sd-role-static  { flex-shrink: 0; padding-right: 4px; }
</style>
