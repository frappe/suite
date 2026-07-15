<template>
	<div class="flex space-x-2">
		<Button
			icon="search"
			:tooltip="__('Search ({0}+K)', [modifier])"
			variant="ghost"
			@click="showSearchModal = true"
		/>
		<Button
			icon-left="edit"
			:label="__('Compose')"
			:tooltip="__('Compose (C)')"
			@click="showSendModal = true"
		/>
	</div>

	<SendMail v-model="showSendModal" @reload-mails="emit('reloadMails')" />
	<SearchModal
		v-model="showSearchModal"
		v-model:show-advanced="showSearchAdvanced"
		v-model:edit-filter="showSearchEditFilter"
	/>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Button } from 'frappe-ui'

import { isMac } from '@/apps/mail/utils'
import SearchModal from '@/apps/mail/components/Modals/SearchModal.vue'
import SendMail from '@/apps/mail/components/SendMail.vue'

const emit = defineEmits(['reloadMails'])

// Exposed as a model so other views (e.g. the search results header's query chip) can reopen the modal.
const showSearchModal = defineModel<boolean>('showSearch', { default: false })
const showSearchAdvanced = defineModel<boolean>('showAdvanced', { default: false })
// Filter key a results-page chip asked to reopen inline; forwarded to the search modal.
const showSearchEditFilter = defineModel<string>('editFilter', { default: '' })
const showSendModal = ref(false)

const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

const handleKeydown = (e: KeyboardEvent) => {
	const target = e.target as HTMLElement
	if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		return

	const key = e.key.toLowerCase()

	// Search shortcut
	if ((e.metaKey || e.ctrlKey) && key === 'k') {
		e.preventDefault()
		showSearchModal.value = true
		return
	}

	// Compose shortcut
	if (key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
		e.preventDefault()
		showSendModal.value = true
	}
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>
