<template>
	<div class="isolate flex h-screen w-screen flex-col bg-surface-base">
		<Navbar
			dropdown="home"
			:primaryButton="{
				label: 'New',
				icon: Plus,
				onClick: () => navigateToEditor(),
			}"
		/>

		<PresentationList
			:loading="presentationListResource.loading && !presentationList.length"
			:presentations="presentationList"
			@setPreview="setPreview"
			@navigate="navigateToPresentation"
			@openDialog="openDialog"
			@duplicatePresentation="(name) => duplicateAndNavigate(name)"
			@newPresentation="navigateToEditor"
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
</template>

<script setup>
import { onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { createResource, dialog } from 'frappe-ui'

import { Plus } from 'lucide-vue-next'

import Navbar from '@/apps/slides/components/Navbar.vue'
import PresentationList from '@/apps/slides/components/PresentationList.vue'
import PresentationPreview from '@/apps/slides/components/PresentationPreview.vue'

import {
	createPresentationResource,
	confirmDeletePresentation,
	duplicatePresentation,
	templateList,
	templateListResource,
	updatePresentationTitle,
} from '@/apps/slides/stores/presentation'
import { requestFullscreen } from '@/apps/slides/stores/slideshow'

const router = useRouter()

const previewPresentation = ref(null)

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
		requestFullscreen()
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
	presentation = presentation || previewPresentation.value
	if (action == 'Rename') {
		promptRename(presentation)
	} else {
		confirmDelete(presentation)
	}
}

const promptRename = (presentation) => {
	dialog.prompt({
		title: 'Rename presentation',
		fields: [
			{
				name: 'title',
				label: 'Title',
				required: true,
				defaultValue: presentation.title,
				validate: (value) => (value.trim() ? null : 'Title is required'),
			},
		],
		confirmLabel: 'Rename',
		onConfirm: async ({ values }) => {
			const title = values.title.trim()
			await updatePresentationTitle(presentation.name, title)
			presentation.title = title
		},
	})
}

const confirmDelete = (presentation) => {
	confirmDeletePresentation(presentation, () => {
		previewPresentation.value = null
		presentationList.value = presentationList.value.filter((p) => p.name !== presentation.name)
	})
}

const setPreview = (presentation) => {
	previewPresentation.value = presentation
}

onActivated(() => {
	if (presentationListResource.fetched) {
		presentationListResource.reload()
	}
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
