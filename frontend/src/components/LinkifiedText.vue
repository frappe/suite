<script setup lang="ts">
import { computed } from 'vue'

// Matches URLs (http/https/www) and email addresses in plain text.
const URL_OR_EMAIL_REGEX =
	/(https?:\/\/[^\s<]+|www\.[^\s<]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
// Anchored form of the email branch above, to tell which kind of link a matched token is. Kept local so
// this stays app-agnostic — mail's isEmail() validates user input, which is a separate concern.
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
// Trailing punctuation unlikely to be part of the link.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

interface Segment {
	text: string
	href?: string
}

const props = defineProps<{ text?: string | null }>()

// Splits the text into plain runs and link runs. Rendered as <span>/<a> elements with the text in
// {{ }} (auto-escaped), so the body can never be interpreted as markup — for rich HTML bodies use
// <EmailContent> (DOMPurify) instead.
const segments = computed<Segment[]>(() => {
	const text = props.text ?? ''
	const result: Segment[] = []
	let lastIndex = 0

	for (const match of text.matchAll(URL_OR_EMAIL_REGEX)) {
		const token = match[0]
		const start = match.index ?? 0

		const before = text.slice(lastIndex, start)
		if (before) result.push({ text: before })

		const trailing = token.match(TRAILING_PUNCTUATION)?.[0] ?? ''
		const link = token.slice(0, token.length - trailing.length)
		const href = EMAIL_REGEX.test(link)
			? `mailto:${link}`
			: link.startsWith('www.')
				? `https://${link}`
				: link

		result.push({ text: link, href })
		if (trailing) result.push({ text: trailing })

		lastIndex = start + token.length
	}

	const rest = text.slice(lastIndex)
	if (rest) result.push({ text: rest })

	return result
})
</script>

<template>
	<!-- Only whitespace/wrapping is baked in — it's what makes plain text render faithfully. Typography,
	     spacing and clamping are the caller's, via class fallthrough. -->
	<div class="whitespace-pre-wrap break-words">
		<template v-for="(segment, index) in segments" :key="index">
			<a
				v-if="segment.href"
				:href="segment.href"
				target="_blank"
				rel="noopener noreferrer"
				class="text-ink-blue-6 hover:underline"
				>{{ segment.text }}</a
			>
			<span v-else>{{ segment.text }}</span>
		</template>
	</div>
</template>
