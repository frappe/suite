<template>
	<EditorContent
		v-if="showEditor"
		:editor="activeEditor"
		:style="editorStyles"
		class="textElement"
		:class="isAutoWidth ? 'text-auto-width' : 'text-fixed-width'"
		@mousedown="handleMouseDown"
		@dblclick="handleDoubleClick"
	/>
	<SlideshowText
		v-else-if="showMagicMoveText"
		:content="element.content"
		class="textElement select-none"
		:class="isAutoWidth ? 'text-auto-width' : 'text-fixed-width'"
		:style="elementLineHeightStyle"
	/>
	<div
		v-else
		v-html="sanitizedContent"
		class="textElement select-none"
		:class="isAutoWidth ? 'text-auto-width' : 'text-fixed-width'"
		:style="elementLineHeightStyle"
		@dblclick="handleDoubleClick"
	></div>
</template>

<script setup>
import { computed, onBeforeMount, inject, ref } from 'vue'

import SlideshowText from '@/apps/slides/components/SlideshowText.vue'

import { sanitizeSlideHTML } from '@/apps/slides/utils/helpers'

import { EditorContent, generateHTML } from '@tiptap/vue-3'

import { useTextEditor } from '@/apps/slides/composables/useTextEditor'

import { focusElementId, activeElement, activeElementIds, setEditableState } from '@/apps/slides/stores/element'
import { isAffectedByMagicMove } from '@/apps/slides/stores/transition'
import { extensions } from '@/apps/slides/stores/tiptapSetup'
import { slideIndex } from '@/apps/slides/stores/slide'

const { activeEditor } = useTextEditor()

const props = defineProps({
	mode: {
		type: String,
		default: 'editor',
	},
	// When true (inside a shape), the editor mounts only when this element is
	// explicitly focused for text editing — not just when it's selected.
	embedded: {
		type: Boolean,
		default: false,
	},
})

const inReadonlyMode = inject('inReadonlyMode', ref(false))
const inSlideShowMode = inject('inSlideShowMode', ref(false))

const showEditor = computed(() => {
	if (props.mode != 'editor') return false
	if (props.embedded) return focusElementId.value == element.value.id && !!activeEditor.value
	return activeElement.value?.id == element.value.id
})

const element = defineModel('element', {
	type: Object,
	default: null,
})

const isEditable = computed(() => focusElementId.value == element.value.id)

const flipTransform = computed(
	() => `scale(${element.value?.invertX || 1}, ${element.value?.invertY || 1})`,
)

const elementLineHeightStyle = computed(() => {
	const styles = { transform: flipTransform.value }
	const lh = element.value?.lineHeight
	if (lh) styles['--el-line-height'] = lh
	return styles
})

const editorStyles = computed(() => ({
	...elementLineHeightStyle.value,
	cursor: isEditable.value ? 'text' : '',
	userSelect: isEditable.value ? 'text' : 'none',
}))

const handleMouseDown = (e) => {
	if (!isEditable.value || inReadonlyMode.value) return

	e.stopPropagation()
}

const handleDoubleClick = (e) => {
	e.stopPropagation()
	if (inSlideShowMode.value || isEditable.value || inReadonlyMode.value || element.value.locked)
		return

	activeElementIds.value = [element.value.id]
	focusElementId.value = element.value.id

	if (activeElement.value.id == element.value.id && activeEditor.value) {
		setEditableState()
	}
}

const normalizeContent = () => {
	const content = element.value.content
	if (content && typeof content == 'object') {
		element.value.content = generateHTML(content, extensions)
	}
}

const sanitizedContent = computed(() => sanitizeSlideHTML(element.value.content || ''))

const isAutoWidth = computed(() => {
	return !element.value.width || element.value.width == 'auto'
})

const showMagicMoveText = computed(
	() =>
		inSlideShowMode.value &&
		isAffectedByMagicMove(slideIndex.value) &&
		![null, undefined, ''].includes(element.value.refId),
)

onBeforeMount(() => normalizeContent())
</script>

<style>
.ProseMirror {
	caret-color: currentColor;
	outline: none;
}

/* match prosemirror's own .ProseMirror rule, else Inter's contextual alternates
   raise punctuation (+ : - =) on the static render but not in the editor */
.textElement,
.textElement .ProseMirror {
	font-variant-ligatures: none;
	font-feature-settings: 'liga' 0;
}

.persisted-selection {
	background-color: Highlight;
}

.tiptap ul,
.textElement > ul {
	list-style: none;
	padding-left: 0;
}

.tiptap > ul li,
.textElement > ul li {
	position: relative;
	padding-left: 0.8em;
}

.tiptap > ul li::before,
.textElement > ul li::before {
	content: '\2022';
	position: absolute;
	left: 0;
	top: 0;
	font-size: 1em;
}

.tiptap ol,
.textElement ol {
	list-style: none;
	margin: 0;
	padding: 0;
	counter-reset: step;
}

.tiptap ol li,
.textElement ol li {
	counter-increment: step;
	position: relative;
	padding-left: calc(2ch + 0.2em);
}

.tiptap ol li::before,
.textElement ol li::before {
	content: counter(step) '.';
	position: absolute;
	left: 0;
	top: 0;
	width: 2ch;
	text-align: right;
}

.text-auto-width,
.text-auto-width .ProseMirror {
	white-space: pre;
}

.text-fixed-width,
.text-fixed-width .ProseMirror {
	width: 100%;
	white-space: pre-wrap;
	overflow-wrap: break-word;
	hyphens: auto;
}

/* use CSS variable set on container to apply legacy element line-height without
   mutating inner HTML. Inline styles on <p> will still take precedence. */
.textElement p,
.textElement li {
	line-height: var(--el-line-height, 1.5);
}
</style>
