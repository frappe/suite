<script setup lang="ts">
import { computed } from 'vue'

import HighlightedText from '@/components/HighlightedText.vue'

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
  /** Which of `marks` this piece of text belongs to. */
  mark?: number
}

// `term`: the words a search found this by, marked where they appear. `marks`: stretches of the
// text the caller acts on when one is clicked or tapped (`pick`, with its index), each saying so
// with `markLabel`; never inside a link, which does something of its own.
const props = defineProps<{
  text?: string | null
  term?: string
  marks?: readonly { index: number; length: number }[]
  markLabel?: string
}>()
const emit = defineEmits<{ pick: [mark: number] }>()

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

  return props.marks?.length ? withMarks(result, props.marks) : result
})

// The plain runs cut at the marks' edges. The runs spell out the text end to end, so a run's place
// in it is the length of those before it.
const withMarks = (runs: Segment[], marks: readonly { index: number; length: number }[]) => {
  const result: Segment[] = []
  let offset = 0
  for (const run of runs) {
    const start = offset
    offset += run.text.length
    if (run.href) {
      result.push(run)
      continue
    }
    let last = 0
    marks.forEach((mark, index) => {
      const from = Math.max(mark.index - start, last)
      const to = Math.min(mark.index + mark.length - start, run.text.length)
      if (from >= to) return
      if (from > last) result.push({ text: run.text.slice(last, from) })
      result.push({ text: run.text.slice(from, to), mark: index })
      last = to
    })
    if (last < run.text.length) result.push({ text: run.text.slice(last) })
  }
  return result
}

// A press that ends a text selection is the reader selecting, not picking.
const pick = (mark: number) => {
  if (window.getSelection()?.isCollapsed === false) return
  emit('pick', mark)
}
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
        ><HighlightedText :text="segment.text" :term="term"
      /></a>
      <span
        v-else-if="segment.mark !== undefined"
        role="button"
        tabindex="0"
        :title="markLabel"
        class="cursor-pointer underline decoration-outline-gray-3 underline-offset-2 hover:decoration-current"
        @click="pick(segment.mark)"
        @keydown.enter.prevent="pick(segment.mark)"
        @keydown.space.prevent="pick(segment.mark)"
        ><HighlightedText :text="segment.text" :term="term"
      /></span>
      <span v-else><HighlightedText :text="segment.text" :term="term" /></span>
    </template>
  </div>
</template>
