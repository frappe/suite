<template>
	<aside v-if="open" class="sn-vh-panel" @click.stop>
		<header class="sn-vh-header">
			<div class="sn-vh-title">Version history</div>
			<Button variant="ghost" size="sm" icon="lucide-x" @click="$emit('close')" />
		</header>

		<div class="sn-vh-filter">
			<Select v-model="filter" :options="FILTER_OPTIONS" size="sm" />
		</div>

		<div v-if="loading" class="sn-vh-empty">Loading…</div>
		<div v-else-if="error" class="sn-vh-empty sn-vh-error">{{ error }}</div>
		<div v-else-if="!visibleGroups.length" class="sn-vh-empty">
			<div class="sn-vh-empty-title">
				{{ filter === 'named' ? 'No named versions yet.' : 'No saved versions yet.' }}
			</div>
			<div class="sn-vh-empty-hint">
				Edits are autosaved continuously — your data is safe.
				Versions appear here after each save (rapid edits are grouped).
			</div>
		</div>

		<div v-else class="sn-vh-list">
			<div v-for="g in visibleGroups" :key="g.date" class="sn-vh-group">
				<div class="sn-vh-group-h">{{ g.label }}</div>
				<div
					v-for="v in g.items"
					:key="v.name"
					class="sn-vh-row"
					:class="{ 'sn-vh-row-active': v.name === activeVersion }"
					@click="$emit('select', v.name)"
				>
					<Avatar :label="shortUser(v.user)" size="sm" />
					<div class="sn-vh-row-body">
						<div class="sn-vh-row-title">
							{{ formatTime(v.timestamp) }}
							<span v-if="v.collapsed_count > 1" class="sn-vh-count">
								· {{ v.collapsed_count }} saves
							</span>
						</div>
						<div class="sn-vh-meta">
							<span class="sn-vh-user">{{ shortUser(v.user) }}</span>
							<span v-if="rowSubtitle(v)" class="sn-vh-sep">·</span>
							<span v-if="rowSubtitle(v)" class="sn-vh-subtitle">{{ rowSubtitle(v) }}</span>
						</div>
					</div>
					<button
						class="sn-vh-row-menu"
						:class="{ 'sn-vh-row-menu-visible': v.name === activeVersion }"
						:title="`More actions for ${formatTime(v.timestamp)}`"
						@click.stop="toggleMenu(v.name, $event)"
					>
						<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
							<circle cx="8" cy="3"  r="1.4" fill="currentColor"/>
							<circle cx="8" cy="8"  r="1.4" fill="currentColor"/>
							<circle cx="8" cy="13" r="1.4" fill="currentColor"/>
						</svg>
					</button>
				</div>
			</div>
		</div>

		<!-- Per-row actions popover; absolutely positioned next to the trigger. -->
		<div
			v-if="menuFor"
			class="sn-vh-menu-pop"
			:style="menuStyle"
			@click.stop
		>
			<button class="sn-vh-menu-item" @click="actionFromMenu('name')">
				{{ menuRow?.version_name ? 'Rename this version' : 'Name this version' }}
			</button>
			<button class="sn-vh-menu-item" @click="actionFromMenu('copy')">
				Make a copy
			</button>
			<button class="sn-vh-menu-item" @click="actionFromMenu('restore')">
				Restore this version
			</button>
		</div>
	</aside>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Avatar, Button, Select } from 'frappe-ui'

const FILTER_OPTIONS = [
	{ label: 'All versions',          value: 'all' },
	{ label: 'Named versions only',   value: 'named' },
]

const props = defineProps({
	open:           { type: Boolean, default: false },
	versions:       { type: Array,   default: () => [] },
	loading:        { type: Boolean, default: false },
	error:          { type: String,  default: '' },
	activeVersion:  { type: String,  default: '' },
})
const emit = defineEmits(['close', 'select', 'name', 'copy', 'restore'])

const filter    = ref('all')
const menuFor   = ref(null)
const menuStyle = ref({})

watch(() => props.open, (open) => {
	if (!open) { filter.value = 'all'; menuFor.value = null }
})

const filteredVersions = computed(() => {
	if (filter.value === 'named') return props.versions.filter(v => v.version_name)
	return props.versions
})

// Coalesce consecutive same-user same-minute entries into one displayed row.
// Avoids the "18 rows from one editing burst" problem.  Keeps the newest
// version's metadata so restore/preview lands on the final state of the burst.
const collapsed = computed(() => {
	const out = []
	for (const v of filteredVersions.value) {
		const last = out[out.length - 1]
		if (last && _sameBurst(last, v)) {
			last.collapsed_count = (last.collapsed_count || 1) + 1
			continue
		}
		out.push({ ...v, collapsed_count: 1 })
	}
	return out
})

function _sameBurst(a, b) {
	if (a.user !== b.user) return false
	if (a.version_name || b.version_name) return false
	if (a.primary_op !== b.primary_op) return false
	return _minuteKey(a.timestamp) === _minuteKey(b.timestamp)
}
function _minuteKey(ts) { return String(ts).slice(0, 16) }

const visibleGroups = computed(() => {
	const byDay = new Map()
	for (const v of collapsed.value) {
		const d = _dayKey(v.timestamp)
		if (!byDay.has(d)) byDay.set(d, [])
		byDay.get(d).push(v)
	}
	return [...byDay.entries()].map(([date, items]) => ({
		date, items, label: dayLabel(date),
	}))
})

const menuRow = computed(() =>
	menuFor.value ? props.versions.find(v => v.name === menuFor.value) : null,
)

function rowSubtitle(v) {
	if (v.version_name)   return v.version_name
	if (v.op_labels?.[0]) return v.op_labels[0]
	return ''
}

function toggleMenu(versionName, evt) {
	if (menuFor.value === versionName) { menuFor.value = null; return }
	const rect = evt.currentTarget.getBoundingClientRect()
	const panelRect = evt.currentTarget.closest('.sn-vh-panel').getBoundingClientRect()
	menuStyle.value = {
		top:   `${rect.bottom - panelRect.top + 4}px`,
		right: `${panelRect.right - rect.right}px`,
	}
	menuFor.value = versionName
}

function actionFromMenu(kind) {
	const target = menuFor.value
	menuFor.value = null
	if (!target) return
	emit(kind, target)
}

function _dayKey(ts) { return String(ts).slice(0, 10) }

function dayLabel(dateStr) {
	const today = _dayKey(new Date().toISOString())
	const yest  = _dayKey(new Date(Date.now() - 86_400_000).toISOString())
	if (dateStr === today) return 'Today'
	if (dateStr === yest)  return 'Yesterday'
	const d = new Date(dateStr)
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(ts) {
	if (!ts) return ''
	const d = new Date(String(ts).replace(' ', 'T'))
	const dayKey   = _dayKey(d.toISOString())
	const todayKey = _dayKey(new Date().toISOString())
	const yestKey  = _dayKey(new Date(Date.now() - 86_400_000).toISOString())
	const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
	if (dayKey === todayKey || dayKey === yestKey) return time
	const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
	return `${date}, ${time}`
}

function shortUser(u) {
	if (!u) return ''
	return u.includes('@') ? u.split('@')[0] : u
}
</script>

<style scoped>
.sn-vh-panel {
	position: absolute;
	top:    0;
	right:  0;
	bottom: 0;
	width:  320px;
	background: var(--surface-base, #ffffff);
	border-left: 1px solid var(--outline-gray-2, #e5e5e5);
	display: flex;
	flex-direction: column;
	z-index: 30;
	box-shadow: -4px 0 12px -8px rgba(0,0,0,0.08);
	animation: sn-vh-slide-in 160ms cubic-bezier(.2, .8, .25, 1);
}
@keyframes sn-vh-slide-in {
	from { transform: translateX(16px); opacity: 0; }
	to   { transform: translateX(0);    opacity: 1; }
}
.sn-vh-header {
	display: flex; align-items: center; justify-content: space-between;
	padding: 10px 12px;
	border-bottom: 1px solid var(--outline-gray-2, #e5e5e5);
}
.sn-vh-title {
	font-weight: 600;
	color: var(--ink-gray-8, #262626);
	font-size: 13px;
}

.sn-vh-filter {
	padding: 8px 12px;
	border-bottom: 1px solid var(--outline-gray-2, #e5e5e5);
}

.sn-vh-list  { flex: 1; overflow-y: auto; padding: 4px 0 12px; }
.sn-vh-group { padding: 4px 0; }
.sn-vh-group-h {
	font-size: 11px; font-weight: 500;
	letter-spacing: 0.02em;
	color: var(--ink-gray-5, #737373);
	padding: 8px 16px 4px;
}

/* Row layout: avatar | content | menu  ── tight, list-style Frappe-UI look. */
.sn-vh-row {
	display: flex; align-items: flex-start; gap: 10px;
	padding: 8px 8px 8px 12px;
	margin: 1px 6px;
	background: transparent;
	color: var(--ink-gray-8, #262626);
	cursor: pointer;
	border-radius: 6px;
	transition: background 0.08s ease;
}
.sn-vh-row:hover           { background: var(--surface-gray-2, #f5f5f5); }
.sn-vh-row-active          { background: var(--surface-gray-2, #f5f5f5); }
.sn-vh-row-active:hover    { background: var(--surface-gray-3, #ebebeb); }

.sn-vh-row-body  { flex: 1; min-width: 0; padding-top: 1px; }
.sn-vh-row-title {
	font-size: 13px;
	font-weight: 500;
	color: var(--ink-gray-8, #262626);
	line-height: 18px;
}
.sn-vh-count  { font-weight: 400; color: var(--ink-gray-5, #737373); }

.sn-vh-meta {
	display: flex; align-items: center; gap: 4px;
	font-size: 12px;
	color: var(--ink-gray-6, #525252);
	margin-top: 1px;
	min-width: 0;
}
.sn-vh-sep      { color: var(--ink-gray-4, #a3a3a3); }
.sn-vh-subtitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sn-vh-row-menu {
	width: 24px; height: 24px; flex-shrink: 0;
	background: transparent; border: 0; cursor: pointer;
	color: var(--ink-gray-5, #737373);
	border-radius: 4px;
	opacity: 0;
	display: flex; align-items: center; justify-content: center;
}
.sn-vh-row:hover .sn-vh-row-menu { opacity: 1; }
.sn-vh-row-menu-visible          { opacity: 1; }
.sn-vh-row-menu:hover {
	background: var(--surface-gray-3, #ebebeb);
	color: var(--ink-gray-8, #262626);
}

.sn-vh-empty {
	padding: 28px 18px;
	color: var(--ink-gray-5, #737373);
	font-size: 13px; text-align: center;
}
.sn-vh-empty-title { font-weight: 500; color: var(--ink-gray-7, #525252); margin-bottom: 6px; }
.sn-vh-empty-hint  { font-size: 12px; line-height: 1.5; color: var(--ink-gray-5, #737373); }
.sn-vh-error { color: var(--ink-red-5, #dc2626); }

.sn-vh-menu-pop {
	position: absolute;
	background: var(--surface-base, #ffffff);
	border: 1px solid var(--outline-gray-2, #e5e5e5);
	border-radius: 6px;
	box-shadow: 0 4px 12px -4px rgba(0,0,0,0.12);
	padding: 4px;
	min-width: 180px;
	z-index: 31;
	animation: sn-vh-menu-rise 120ms ease-out;
	transform-origin: top right;
}
@keyframes sn-vh-menu-rise {
	from { transform: translateY(-4px) scale(0.98); opacity: 0; }
	to   { transform: translateY(0)    scale(1);    opacity: 1; }
}
.sn-vh-menu-item {
	display: block; width: 100%; text-align: left;
	background: transparent; border: 0; cursor: pointer;
	padding: 7px 10px; font: inherit;
	color: var(--ink-gray-8, #262626);
	font-size: 13px; border-radius: 4px;
}
.sn-vh-menu-item:hover { background: var(--surface-gray-2, #f5f5f5); }
</style>
