<template>
	<div class="flex h-screen w-screen flex-col">
		<Navbar
			:primaryButton="{
				label: 'New',
				icon: Plus,
				onClick: () => navigateToEditor(),
			}"
		/>

		<PresentationList
			:loading="presentationListResource.loading"
			:presentations="presentationList"
			@setPreview="setPreview"
			@navigate="navigateToPresentation"
			@openDialog="openDialog"
			@duplicatePresentation="(name) => duplicateAndNavigate(name)"
		/>

		<PresentationPreview
			v-if="previewPresentation"
			:presentation="previewPresentation"
			@setPreview="setPreview"
			@openDialog="openDialog"
			@navigate="navigateToPresentation"
			@duplicatePresentation="(name) => duplicateAndNavigate(name)"
		/>
	</div>

	<PresentationActionDialog
		v-model="showDialog"
		:dialogAction="dialogAction"
		:presentation="selectedPresentation"
		@closeDialog="closeDialog"
		@updatePresentationList="updatePresentationList"
	/>
</template>

<script setup>
import { onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { previousRoute } from '@/apps/slides/router'

import { createResource } from 'frappe-ui'

import { Plus } from 'lucide-vue-next'

import Navbar from '@/apps/slides/components/Navbar.vue'
import PresentationList from '@/apps/slides/components/PresentationList.vue'
import PresentationPreview from '@/apps/slides/components/PresentationPreview.vue'
import PresentationActionDialog from '@/apps/slides/components/PresentationActionDialog.vue'

import {
	createPresentationResource,
	duplicatePresentation,
	unsyncedPresentationRecord,
	templateList,
	templateListResource,
} from '@/apps/slides/stores/presentation'

const router = useRouter()

const previewPresentation = ref(null)
const selectedPresentation = ref(null)

const showDialog = ref(false)
const dialogAction = ref('')

const presentationList = ref([])

const presentationListResource = createResource({
	url: 'suite.slides.doctype.presentation.presentation.get_presentations',
	method: 'GET',
	auto: true,
	cache: 'presentations',
})

watch(
	() => presentationListResource.data,
	(data) => {
		if (data) presentationList.value = data
	},
	{ immediate: true },
)

const navigateToPresentation = (name, present) => {
	name = name || previewPresentation.value?.name
	previewPresentation.value = null
	if (present) {
		router.replace({
			name: 'slides-slideshow',
			params: { presentationId: name },
			query: { slide: 1 },
		})
	} else {
		router.push({
			name: 'slides-editor',
			params: { presentationId: name },
			query: { slide: 1 },
		})
	}
}

const openDialog = (action, presentation) => {
	dialogAction.value = action
	showDialog.value = true
	selectedPresentation.value = presentation || previewPresentation.value
}

const closeDialog = () => {
	showDialog.value = false
}

const updatePresentationList = (action, newTitle) => {
	if (action == 'Delete') {
		previewPresentation.value = null
		presentationList.value = presentationList.value.filter(
			(p) => p.name !== selectedPresentation.value.name,
		)
	} else if (action == 'Rename' && newTitle) {
		selectedPresentation.value.title = newTitle
	}
}

const setPreview = (presentation) => {
	previewPresentation.value = presentation
}

const openThemeDialog = () => {
	showThemeDialog.value = true
}

const syncPresentationRecord = () => {
	const newValues = unsyncedPresentationRecord.value
	if (!Object.keys(newValues).length) return

	if (newValues.deleted) {
		presentationList.value = presentationList.value.filter((p) => p.name !== newValues.name)
		unsyncedPresentationRecord.value = {}
		return
	}

	const presentationRecord = presentationList.value.find(
		(p) => p.name == (newValues.name || previousRoute.params.presentationId),
	)
	if (!presentationRecord) return

	Object.entries(newValues).forEach(([key, val]) => {
		if (![null, undefined, ''].includes(val)) {
			presentationRecord[key] = val
		}
	})

	unsyncedPresentationRecord.value = {}
}

onActivated(() => {
	if (previousRoute?.name == 'slides-editor') {
		syncPresentationRecord()
	}
})

watch(unsyncedPresentationRecord, () => {
	syncPresentationRecord()
})

onMounted(() => {
	if (!templateList.value.length) {
		templateListResource.fetch()
	}
})

const navigateToEditor = () => {
	router.push({ name: 'slides-editor-new' })
}

const duplicateAndNavigate = async (presentation) => {
	const newPresentation = await duplicatePresentation(presentation)
	navigateToPresentation(newPresentation)
}
</script>
