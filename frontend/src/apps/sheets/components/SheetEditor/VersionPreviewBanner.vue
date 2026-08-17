<template>
	<div v-if="open" class="sn-vp-banner">
		<div class="sn-vp-left">
			<Button variant="ghost" size="sm" icon="lucide-arrow-left"
			        :tooltip="'Exit version history'"
			        @click="$emit('exit')" />
			<span class="sn-vp-text">
				Previewing <b>{{ formatTimestamp(version?.timestamp) }}</b>
				<span v-if="version?.version_name"> · <em>{{ version.version_name }}</em></span>
				<span v-if="version?.user"> · {{ shortUser(version.user) }}</span>
			</span>
			<span v-if="diff" class="sn-vp-diff">
				·
				<b>{{ diff.total_changed_cells }}</b> edit{{ diff.total_changed_cells === 1 ? '' : 's' }}
				<span class="sn-vp-rows-meta">({{ diff.total_changed_rows }} row{{ diff.total_changed_rows === 1 ? '' : 's' }} changed)</span>
			</span>
		</div>
		<div class="sn-vp-mid">
			<Button v-if="diff && diff.total_changed_cells > 0"
			        size="sm" variant="ghost" icon="lucide-chevron-up"
			        :tooltip="'Previous change'"
			        :disabled="!canStep"
			        @click="$emit('step', -1)" />
			<span v-if="diff && diff.total_changed_cells > 0 && stepIndex !== null"
			      class="sn-vp-step">
				{{ stepIndex + 1 }} / {{ diff.total_changed_cells }}
			</span>
			<Button v-if="diff && diff.total_changed_cells > 0"
			        size="sm" variant="ghost" icon="lucide-chevron-down"
			        :tooltip="'Next change'"
			        :disabled="!canStep"
			        @click="$emit('step', +1)" />
		</div>
		<div class="sn-vp-right">
			<Button size="sm" variant="ghost" iconLeft="lucide-edit-2"
			        @click="$emit('name')">{{ version?.version_name ? 'Rename' : 'Name version' }}</Button>
			<Button size="sm" variant="solid"
			        :loading="restoring"
			        @click="$emit('restore')">Restore this version</Button>
		</div>
	</div>
</template>

<script setup>
import { computed } from 'vue'
import { Button } from 'frappe-ui'

const props = defineProps({
	open:       { type: Boolean, default: false },
	version:    { type: Object,  default: null },
	restoring:  { type: Boolean, default: false },
	diff:       { type: Object,  default: null },
	stepIndex:  { type: Number,  default: null },
})
defineEmits(['restore', 'exit', 'name', 'step'])

const canStep = computed(() => !!(props.diff && props.diff.total_changed_cells > 1))

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
</script>

<style scoped>
.sn-vp-banner {
	display: flex; align-items: center; justify-content: space-between;
	gap: 12px;
	padding: 6px 12px;
	background: var(--surface-gray-2);
	border-bottom: 1px solid var(--outline-gray-2);
	color: var(--ink-gray-8);
	font-size: 13px;
	animation: sn-vp-drop 140ms ease-out;
}
@keyframes sn-vp-drop {
	from { transform: translateY(-100%); opacity: 0; }
	to   { transform: translateY(0);     opacity: 1; }
}
.sn-vp-left  { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.sn-vp-text  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sn-vp-diff  { color: var(--ink-gray-6); margin-left: 6px; }
.sn-vp-rows-meta { color: var(--ink-gray-5); font-size: 12px; }
.sn-vp-mid   { display: flex; align-items: center; gap: 4px; }
.sn-vp-step  { font-size: 12px; color: var(--ink-gray-6); min-width: 48px; text-align: center; }
.sn-vp-right { display: flex; gap: 6px; flex-shrink: 0; }
</style>
