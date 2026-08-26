<template>
	<div
		:class="inputClasses"
		:contenteditable="editingTitle"
		spellcheck="false"
		@click="makeTitleEditable"
		@focus="setCursorPositionAtEnd"
		@blur="saveTitle"
		@keydown.enter.prevent.stop="(e) => e.target.blur()"
		@keydown.esc.prevent.stop="cancelTitle"
	>
		{{ title }}
	</div>
</template>

<script setup>
import { ref, computed, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { updatePresentationTitle } from '@/apps/slides/stores/presentation'
import { setCursorPositionAtEnd } from '@/apps/slides/utils/helpers'

const props = defineProps({
	title: String,
})

const inReadonlyMode = inject('inReadonlyMode', ref(false))

const route = useRoute()
const router = useRouter()

const editingTitle = ref(false)

const inputClasses = computed(() => {
	const baseClasses = [
		'h-7 px-2 py-1.5',
		'text-base font-medium cursor-text text-ink-gray-8',
		'outline-none rounded-4',
		'focus:ring-1 focus:ring-outline-gray-3',
		'transition ease-in-out duration-400',
		'whitespace-nowrap',
	]
	if (editingTitle.value) {
		return [...baseClasses, 'max-w-[500px]']
	}
	const hoverClasses = inReadonlyMode.value ? [] : ['hover:bg-surface-gray-2']
	return [...baseClasses, ...hoverClasses, 'truncate', 'max-w-[500px]']
})

const makeTitleEditable = (e) => {
	if (editingTitle.value || inReadonlyMode.value) return

	editingTitle.value = true
	e.target.focus()
	e.target.tabIndex = 0
}

const cancelTitle = (e) => {
	e.target.innerText = props.title
	e.target.blur()
}

const saveTitle = async (e) => {
	editingTitle.value = false

	const newTitle = e.target.innerText.trim()

	if (!newTitle) {
		e.target.innerText = props.title
		return
	}

	if (newTitle != props.title) {
		const slug = await updatePresentationTitle(route.params.presentationId, newTitle)
		router.replace({
			name: 'slides-editor',
			params: { presentationId: route.params.presentationId, slug: slug },
			query: route.query,
		})
	}
}
</script>
