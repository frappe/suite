<template>
	<Dialog v-model="show" :options="{ title: __('Attach from Frappe Drive'), size: '3xl' }">
		<template #body-content>
			<div class="flex flex-col gap-3">
				<!-- Team selector (only when the user belongs to more than one team) -->
				<FormControl
					v-if="teamOptions.length > 1"
					v-model="team"
					type="select"
					:label="__('Team')"
					:options="teamOptions"
					@update:model-value="onTeamChange"
				/>

				<!-- Breadcrumb: click a crumb to jump back up the folder path -->
				<div class="text-ink-gray-6 flex items-center gap-1 text-sm">
					<button
						v-for="(crumb, i) in breadcrumbs"
						:key="crumb.name ?? 'root'"
						class="flex items-center gap-1 hover:text-ink-gray-8"
						:class="{ 'text-ink-gray-8 font-medium': i === breadcrumbs.length - 1 }"
						@click="goToCrumb(i)"
					>
						<ChevronRight v-if="i > 0" class="h-3.5 w-3.5" />
						<span class="max-w-40 truncate">{{ crumb.label }}</span>
					</button>
				</div>

				<!-- File / folder list -->
				<div class="h-72 overflow-y-auto rounded border">
					<div
						v-if="files.loading"
						class="text-ink-gray-5 flex h-full items-center justify-center text-sm"
					>
						{{ __('Loading…') }}
					</div>
					<div
						v-else-if="!entries.length"
						class="text-ink-gray-5 flex h-full items-center justify-center text-sm"
					>
						{{ __('This folder is empty.') }}
					</div>
					<template v-else>
						<div
							v-for="entry in entries"
							:key="entry.name"
							class="hover:bg-surface-gray-2 flex items-center gap-2 px-3 py-2"
							:class="{ 'cursor-pointer': entry.is_folder }"
							@click="entry.is_folder ? openFolder(entry) : toggle(entry)"
						>
							<Checkbox
								v-if="!entry.is_folder"
								:model-value="selected.has(entry.name)"
								@click.stop="toggle(entry)"
							/>
							<component
								:is="entry.is_folder ? Folder : File"
								class="text-ink-gray-6 h-4 w-4 shrink-0"
							/>
							<span class="min-w-0 flex-1 truncate text-sm">{{ entry.file_name }}</span>
							<span v-if="!entry.is_folder" class="text-ink-gray-5 shrink-0 text-xs">
								{{ formatSize(entry.file_size) }}
							</span>
							<ChevronRight v-else class="text-ink-gray-5 h-4 w-4 shrink-0" />
						</div>
					</template>
				</div>
			</div>
		</template>
		<template #actions>
			<div class="flex items-center justify-between">
				<span class="text-ink-gray-5 text-sm">
					{{ selected.size ? __('{0} selected', [String(selected.size)]) : '' }}
				</span>
				<Button
					variant="solid"
					:label="__('Attach')"
					:disabled="!selected.size"
					@click="attach"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, File, Folder } from 'lucide-vue-next'
import { Button, Checkbox, Dialog, FormControl, createResource } from 'frappe-ui'

interface DriveEntry {
	name: string
	file_name: string
	is_folder: 0 | 1 | boolean
	file_size: number
	mime_type?: string
}

const show = defineModel<boolean>()
const emit = defineEmits<{ attach: [entries: DriveEntry[]] }>()

// Folder path we've navigated into; the first crumb (name: null) is the team home.
const breadcrumbs = ref<{ name: string | null; label: string }[]>([
	{ name: null, label: __('Home') },
])
const currentFolder = computed(() => breadcrumbs.value.at(-1)?.name ?? undefined)
const selected = ref<Set<string>>(new Set())
const selectedEntries = new Map<string, DriveEntry>()

// Teams the user can browse. `get_teams(details=1)` returns a dict keyed by team id, with the team
// doc as the value. First team is used by default; a selector shows only when there's a choice.
type TeamMap = Record<string, { title?: string; team_name?: string }>
const team = ref<string>('')
const teams = createResource({
	url: 'suite.drive.api.permissions.get_teams',
	// exclude_personal: 0 → include the user's personal Drive team (excluded by default), so
	// single-user setups (whose only team is personal) still have somewhere to browse.
	params: { details: 1, exclude_personal: 0 },
	auto: false,
	onSuccess: (data: TeamMap) => {
		const ids = Object.keys(data ?? {})
		if (!team.value && ids.length) team.value = ids[0]
		load()
	},
})
const teamOptions = computed(() =>
	Object.entries((teams.data ?? {}) as TeamMap).map(([name, t]) => ({
		label: t.title || t.team_name || name,
		value: name,
	})),
)

const files = createResource({
	url: 'suite.drive.api.list.files',
	// Omit entity_name at the root so the backend defaults to the team home folder; a serialized
	// `entity_name=undefined` would be looked up as a (missing) File and error out.
	makeParams: () => {
		const params: { team: string; entity_name?: string } = { team: team.value }
		if (currentFolder.value) params.entity_name = currentFolder.value
		return params
	},
	auto: false,
})
// Folders first, then files, each alphabetical — a predictable browse order.
const entries = computed<DriveEntry[]>(() =>
	[...((files.data as DriveEntry[]) ?? [])].sort(
		(a, b) =>
			Number(!!b.is_folder) - Number(!!a.is_folder) ||
			a.file_name.localeCompare(b.file_name),
	),
)

const formatSize = (bytes: number) => {
	if (!bytes) return ''
	const units = ['B', 'KB', 'MB', 'GB']
	let size = bytes
	let unit = 0
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024
		unit++
	}
	return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

// Fetch the current folder's contents. Called explicitly on open, folder navigation, and team change
// (rather than via a watcher) so the request reliably fires once a team is known.
const load = () => {
	if (team.value) files.reload()
}

const openFolder = (entry: DriveEntry) => {
	breadcrumbs.value.push({ name: entry.name, label: entry.file_name })
	load()
}
const goToCrumb = (i: number) => {
	if (i === breadcrumbs.value.length - 1) return
	breadcrumbs.value = breadcrumbs.value.slice(0, i + 1)
	load()
}
const toggle = (entry: DriveEntry) => {
	if (selected.value.has(entry.name)) {
		selected.value.delete(entry.name)
		selectedEntries.delete(entry.name)
	} else {
		selected.value.add(entry.name)
		selectedEntries.set(entry.name, entry)
	}
}
const attach = () => {
	emit('attach', [...selectedEntries.values()])
	show.value = false
}

// Reset to the team home and (re)load whenever the picker opens.
watch(show, (open) => {
	if (!open) return
	breadcrumbs.value = [{ name: null, label: __('Home') }]
	selected.value = new Set()
	selectedEntries.clear()
	// teams.onSuccess calls load() once the team is known; if teams are already loaded, load now.
	if (teams.data) load()
	else teams.fetch()
})
// Changing team (multi-team users) re-roots the browse at that team's home.
const onTeamChange = () => {
	breadcrumbs.value = [{ name: null, label: __('Home') }]
	load()
}
</script>
