<script setup lang="ts">
import { Tooltip } from 'frappe-ui'
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
// in it is the length of those before it. A mark is one control or none: one that reaches into a
// link, or past its run, is left out.
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
      if (mark.index < start || mark.index + mark.length > offset) return
      const from = mark.index - start
      const to = from + mark.length
      if (from > last) result.push({ text: run.text.slice(last, from) })
      result.push({ text: run.text.slice(from, to), mark: index })
      last = to
    })
    if (last < run.text.length) result.push({ text: run.text.slice(last) })
  }
  return result
}

// A mark is focusable so Tab reaches it, but a browser starts no selection at the edge of a
// focusable element: while a press on it lasts it isn't one. It is again once the press ends,
// wherever it ends, and before any key can move focus. Where the press began tells a tap from a
// drag.
let pressed: { x: number; y: number; mark: number } | undefined
const ENDS_A_PRESS = ['pointerup', 'pointercancel', 'lostpointercapture', 'keydown'] as const
const press = (event: PointerEvent, mark: number) => {
  pressed = { x: event.clientX, y: event.clientY, mark }
  const element = event.currentTarget
  if (!(element instanceof HTMLElement)) return
  element.removeAttribute('tabindex')
  const refocusable = (end: Event) => {
    // A drag let go outside the window sends no pointerup: the pointer back with no button down
    // says it is over.
    if (end.type === 'pointermove' && end instanceof MouseEvent && end.buttons) return
    if (end.type === 'pointercancel') pressed = undefined
    element.setAttribute('tabindex', '0')
    for (const type of [...ENDS_A_PRESS, 'pointermove'])
      window.removeEventListener(type, refocusable, true)
  }
  for (const type of [...ENDS_A_PRESS, 'pointermove'])
    window.addEventListener(type, refocusable, true)
}

// A pick is a press and release in place that selected nothing: a drag, or a press that ends a
// selection, is the reader selecting text. A click with no press of its own on the mark (a screen
// reader's, say) is a pick.
const pick = (mark: number, event?: MouseEvent) => {
  const from = pressed
  pressed = undefined
  const moved =
    event && from?.mark === mark && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 4
  if (moved || window.getSelection()?.isCollapsed === false) return
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
      <Tooltip v-else-if="segment.mark !== undefined" :text="markLabel" :disabled="!markLabel">
        <span
          role="button"
          tabindex="0"
          class="cursor-pointer underline decoration-[color:color-mix(in_srgb,currentColor_50%,transparent)] underline-offset-2 hover:decoration-current"
          @pointerdown="press($event, segment.mark)"
          @click="pick(segment.mark, $event)"
          @keydown.enter.prevent="pick(segment.mark)"
          @keydown.space.prevent="pick(segment.mark)"
          ><HighlightedText :text="segment.text" :term="term"
        /></span>
      </Tooltip>
      <span v-else><HighlightedText :text="segment.text" :term="term" /></span>
    </template>
  </div>
</template>
