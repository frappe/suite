<template>
	<Section label="Playback">
		<PropertyRow label="Replace">
			<Button variant="ghost" class="max-w-[45%]" :title="fileName" @click="openFilePicker">
				<span class="min-w-0 truncate text-ink-gray-7">{{ fileName }}</span>
			</Button>
		</PropertyRow>
		<PropertyRow label="Autoplay" class="cursor-pointer" @click="toggleFromRow($event, 'autoplay')">
			<Switch :modelValue="activeElement.autoplay" @update:modelValue="setAutoplay" />
		</PropertyRow>
		<PropertyRow label="Loop" class="cursor-pointer" @click="toggleFromRow($event, 'loop')">
			<Switch :modelValue="activeElement.loop" @update:modelValue="setLoop" />
		</PropertyRow>
		<NumberControl
			:modelValue="activeElement.playbackRate ?? 1"
			label="Speed"
			suffix="x"
			:min="0.5"
			:max="2"
			:max-digits="3"
			:step="0.1"
			@update:modelValue="playbackRate.set"
			@change-start="playbackRate.begin"
			@change-end="playbackRate.commit"
		/>
		<input ref="filePicker" type="file" class="hidden" accept="video/*" @change="replaceVideo" />
	</Section>
</template>

<script setup>
import { computed, useTemplateRef } from 'vue'

import { Button, Switch } from 'frappe-ui'

import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import { activeElement } from '@/apps/slides/stores/element'
import {
	setElementProperty,
	useElementProperty,
} from '@/apps/slides/composables/editProperty'
import { handleUploadedMedia } from '@/apps/slides/utils/mediaUploads'

const setAutoplay = (value) => setElementProperty('autoplay', value)
const setLoop = (value) => setElementProperty('loop', value)

// the switch handles its own clicks; the rest of the row forwards to it
const toggleFromRow = (e, property) => {
	if (!e.target.closest('button')) setElementProperty(property, !activeElement.value[property])
}

const playbackRate = useElementProperty('playbackRate')

const fileName = computed(() => decodeURIComponent(activeElement.value?.src.split('/').pop() ?? ''))

const filePicker = useTemplateRef('filePicker')

const openFilePicker = () => filePicker.value.click()

const replaceVideo = (e) => {
	const file = e.target.files[0]
	if (file) handleUploadedMedia([file], activeElement.value)
	e.target.value = ''
}
</script>
