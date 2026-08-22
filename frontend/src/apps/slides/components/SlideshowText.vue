<template>
	<div ref="textRef" v-html="textHTML"></div>
</template>
<script setup>
import { ref, watch } from 'vue'

import { getDocFromHTML, sanitizeSlideHTML } from '@/apps/slides/utils/helpers'

const props = defineProps({
	content: {
		type: String,
		required: true,
	},
})

const textRef = ref(null)

// spaces stay real: &nbsp; forbids soft wraps, so a fixed-width element
// would overflow its box on one line instead of wrapping like its editor render
const encodeCharForHtml = (c) => {
	switch (c) {
		case '&':
			return '&amp;'
		case '<':
			return '&lt;'
		case '>':
			return '&gt;'
		default:
			return c
	}
}

const getClosestSpan = (node, root) => {
	let el = node.parentElement
	while (el && el !== root) {
		if (el.tagName && el.tagName.toLowerCase() === 'span') return el
		el = el.parentElement
	}
	return null
}

const getWrappingTags = (txt, span) => {
	const inlineTags = ['strong', 'b', 'u', 'i', 'em', 's']

	let openWrap = ''
	let closeWrap = ''

	let el = txt.parentElement
	while (el && el !== span) {
		const tag = el.tagName && el.tagName.toLowerCase()

		if (inlineTags.includes(tag)) {
			openWrap = `<${tag}>` + openWrap
			closeWrap = closeWrap + `</${tag}>`
		}

		el = el.parentElement
	}

	return { openWrap, closeWrap }
}

const createSpansForTextNode = (blockNode, textNode) => {
	let spansHTML = ''

	const span = getClosestSpan(textNode, blockNode)
	const style = span?.getAttribute('style')?.replace(/"/g, "'") || ''

	const { openWrap, closeWrap } = getWrappingTags(textNode, span)

	for (const ch of textNode.nodeValue) {
		// every character in text node,
		// style same as the parent span it belongs to
		// copy over any wrapping inline tags for character span
		spansHTML += `<span style="${style}">${openWrap}${encodeCharForHtml(ch)}${closeWrap}</span>`
	}

	return spansHTML
}

const getNewChildrenHTML = (blockNode) => {
	let childrenHTML = ''

	const walker = document.createTreeWalker(
		blockNode,
		NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
	)
	while (walker.nextNode()) {
		const node = walker.currentNode

		if (node.nodeType === Node.TEXT_NODE) {
			// for every text node, apply span styling to chars
			childrenHTML += createSpansForTextNode(blockNode, node)
		} else if (node.tagName === 'BR') {
			// a hard break carries no text, so a text-only walk drops it and the line merges
			childrenHTML += '<br>'
		}
	}

	return childrenHTML
}

// an <li> holding a nested list has blocks of its own inside it: splitting that
// one would flatten the nesting away, and the walker reaches its inner blocks anyway
const isTextBlock = (node) =>
	['P', 'LI'].includes(node.tagName) && !node.querySelector('p, ul, ol')

const getHTMLForContent = (content = props.content) => {
	const doc = getDocFromHTML(content)

	const walker = doc.createTreeWalker(
		doc.body,
		typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_ELEMENT : 1,
		null,
		false,
	)

	while (walker.nextNode()) {
		const node = walker.currentNode
		if (isTextBlock(node)) {
			const nodeCopy = node.cloneNode(true)
			// replace current html with new html having split spans
			node.innerHTML = getNewChildrenHTML(nodeCopy)
		}
	}

	return sanitizeSlideHTML(doc.body.innerHTML)
}

// split initial content into per-character spans for transitions
const textHTML = ref(getHTMLForContent())

const getCurrentAndNewBlocks = (html) => {
	const newDoc = getDocFromHTML(html)

	const container = textRef.value
	const selector = 'p, li'

	const currentBlocks = container
		? Array.from(container.querySelectorAll(selector)).filter(isTextBlock)
		: []
	const newBlocks = Array.from(newDoc.body.querySelectorAll(selector)).filter(isTextBlock)

	return { currentBlocks, newBlocks }
}

const getSpansFromBlocks = (currentBlocks, newBlocks, i) => {
	const currSpans = Array.from(currentBlocks[i].querySelectorAll('span'))
	const newSpans = Array.from(newBlocks[i].querySelectorAll('span'))

	return { currSpans, newSpans }
}

// only spans get updated in place, so a block whose breaks moved needs the full
// replace even when its span count is unchanged
const getBlockStructure = (block) =>
	Array.from(block.children)
		.map((node) => node.tagName)
		.join(',')

const updateSpanStyles = (span, newSpan) => {
	const style = newSpan.getAttribute('style') || ''
	span.setAttribute('style', style)
	span.innerHTML = newSpan.innerHTML
}

const updateStylesForExistingContent = (newHTML) => {
	const { currentBlocks, newBlocks } = getCurrentAndNewBlocks(newHTML)

	if (!textRef.value || currentBlocks.length !== newBlocks.length) {
		textHTML.value = newHTML
		return
	}

	for (let i = 0; i < currentBlocks.length; i++) {
		const { currSpans, newSpans } = getSpansFromBlocks(currentBlocks, newBlocks, i)

		if (
			currSpans.length !== newSpans.length ||
			getBlockStructure(currentBlocks[i]) !== getBlockStructure(newBlocks[i])
		) {
			textHTML.value = newHTML
			return
		}

		for (let j = 0; j < currSpans.length; j++) {
			updateSpanStyles(currSpans[j], newSpans[j])
		}
	}
}

watch(
	() => props.content,
	(newContent) => {
		if (!newContent) return

		const newHTML = getHTMLForContent(newContent)

		// update character-span styles in existing content instead of replacing entire HTML
		// intentional to preserve ongoing CSS transitions
		updateStylesForExistingContent(newHTML)
	},
)
</script>
