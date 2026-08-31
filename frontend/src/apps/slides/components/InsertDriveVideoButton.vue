<template>
	<Tooltip text="Insert from Drive" :hover-delay="0.7">
		<div class="cursor-pointer rounded-4 p-2 hover:bg-surface-gray-3" @click="openPicker">
			<HardDrive class="size-4 stroke-[1.5] text-ink-gray-7" />
		</div>
	</Tooltip>

	<Dialog v-model:open="showDialog" title="Insert video from Drive">
		<div>
			<SearchInput v-model="search" placeholder="Search your Drive" />
			<div class="no-scrollbar mt-3 flex max-h-80 flex-col gap-0.5 overflow-y-auto">
				<button
					v-for="file in videos"
					:key="file.name"
					type="button"
					class="flex w-full items-center gap-2 rounded-4 px-2 py-2 text-start hover:bg-surface-gray-2"
					@click="insert(file)"
				>
					<FileVideo class="size-4 shrink-0 text-ink-gray-5" />
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm text-ink-gray-8">{{ file.file_name }}</div>
						<div class="truncate text-xs text-ink-gray-5">Edited {{ dayjs(file.modified).fromNow() }}</div>
					</div>
				</button>

				<LoadingIndicator v-if="loading" class="m-auto w-3 py-4" />
				<div v-else-if="!videos.length" class="py-6 text-center text-sm text-ink-gray-5">
					{{ search ? `No videos found for "${search}"` : 'No videos in your Drive yet' }}
				</div>
			</div>
		</div>
	</Dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

import { HardDrive, FileVideo } from 'lucide-vue-next'
import { Dialog, Tooltip, LoadingIndicator } from 'frappe-ui'

import SearchInput from '@/apps/slides/components/controls/SearchInput.vue'
import dayjs from '@/apps/slides/utils/dayjs'
import { listDriveVideos } from '@/apps/slides/utils/driveVideo'
import { addDriveVideoElement } from '@/apps/slides/stores/element'

const showDialog = ref(false)
const search = ref('')
const videos = ref([])
const loading = ref(false)

const openPicker = () => {
	showDialog.value = true
	search.value = ''
	fetchVideos()
}

const fetchVideos = async () => {
	loading.value = true
	try {
		videos.value = await listDriveVideos(search.value)
	} catch {
		videos.value = []
	} finally {
		loading.value = false
	}
}

// debounced so a search doesn't fire a request per keystroke
let searchTimeout = null
watch(search, () => {
	clearTimeout(searchTimeout)
	searchTimeout = setTimeout(fetchVideos, 300)
})

const insert = (file) => {
	addDriveVideoElement(file.name)
	showDialog.value = false
}
</script>
