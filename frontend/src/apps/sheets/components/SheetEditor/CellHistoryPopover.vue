<template>
	<Dialog v-model:open="model" :title="`Edit history for ${cellRef}`" size="sm">
		<template #default>
			<div v-if="loading" class="sn-ch-empty">Loading…</div>
			<div v-else-if="error" class="sn-ch-empty sn-ch-error">{{ error }}</div>
			<div v-else-if="!entries.length" class="sn-ch-empty">
				No edits recorded for this cell yet.
			</div>
			<ul v-else class="sn-ch-list">
				<li v-for="e in entries" :key="e.version" class="sn-ch-item">
					<div class="sn-ch-meta">
						<span class="sn-ch-time">{{ formatTimestamp(e.timestamp) }}</span>
						<span class="sn-ch-user">{{ shortUser(e.user) }}</span>
					</div>
					<div class="sn-ch-change">
						<span class="sn-ch-before">{{ displayValue(e.before) }}</span>
						<span class="sn-ch-arrow">→</span>
						<span class="sn-ch-after">{{ displayValue(e.after) }}</span>
					</div>
				</li>
			</ul>
		</template>
	</Dialog>
</template>

<script setup>
import { computed } from 'vue'
import { Dialog } from 'frappe-ui'

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	cellRef:    { type: String,  default: '' },
	entries:    { type: Array,   default: () => [] },
	loading:    { type: Boolean, default: false },
	error:      { type: String,  default: '' },
})
const emit = defineEmits(['update:modelValue'])

const model = computed({
	get() { return props.modelValue },
	set(v) { emit('update:modelValue', v) },
})

function formatTimestamp(ts) {
	if (!ts) return ''
	const d = new Date(String(ts).replace(' ', 'T'))
	return d.toLocaleString(undefined, {
		month: 'short', day: 'numeric',
		hour: 'numeric', minute: '2-digit',
	})
}

function shortUser(u) {
	if (!u) return ''
	return u.includes('@') ? u.split('@')[0] : u
}

function displayValue(v) {
	if (v === null || v === undefined || v === '') return '(empty)'
	return String(v)
}
</script>

<style scoped>
.sn-ch-list { list-style: none; padding: 0; margin: 0; max-height: 360px; overflow-y: auto; }
.sn-ch-item {
	padding: 10px 0;
	border-bottom: 1px solid var(--outline-gray-2);
}
.sn-ch-item:last-child { border-bottom: 0; }
.sn-ch-meta {
	display: flex; justify-content: space-between;
	font-size: 12px; color: var(--ink-gray-5); margin-bottom: 4px;
}
.sn-ch-change {
	display: flex; align-items: center; gap: 8px;
	font-size: 13px; color: var(--ink-gray-8);
}
.sn-ch-before, .sn-ch-after {
	max-width: 40%;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	padding: 2px 6px; border-radius: 4px;
	background: var(--surface-gray-2);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.sn-ch-after  { background: var(--surface-gray-3); }
.sn-ch-arrow  { color: var(--ink-gray-5); }
.sn-ch-empty  { padding: 24px 8px; text-align: center; color: var(--ink-gray-5); font-size: 13px; }
.sn-ch-error  { color: var(--ink-red-5); }
</style>
