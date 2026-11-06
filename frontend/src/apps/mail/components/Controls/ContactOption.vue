<template>
  <!-- leading-tighter, so stacked lines sit all but flush. A list row wants that tightness; the
	     bigger, standalone form wants the two lines to read as one card. -->
  <div class="min-w-0" :class="{ 'space-y-0.5': size === 'md' }">
    <div class="text-ink-gray-8 truncate leading-tighter" :class="{ 'text-base': size === 'md' }">
      <template v-for="(part, i) in highlight(contact.display_name || contact.email)" :key="i">
        <span v-if="part.match" class="!font-medium">{{ part.text }}</span>
        <template v-else>{{ part.text }}</template>
      </template>
    </div>
    <!-- Only worth a second line when the first one isn't already the address. It is what the mail
		     goes to, so it reads at the row's own size rather than as a caption under the name. -->
    <div
      v-if="contact.display_name"
      class="text-ink-gray-6 truncate leading-tighter"
      :class="{ 'text-sm': size === 'md' }"
    >
      <template v-for="(part, i) in addressParts" :key="i">
        <span
          :class="{
            'text-ink-gray-8 !font-medium': part.match,
            'text-ink-gray-8': part.domain && !part.match,
          }"
          >{{ part.text }}</span
        >
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { DraftRecipient } from '@/apps/mail/types'

// How a contact reads in any of the pickers — recipient autocomplete, the contacts
// combobox, `@` mentions. The address is the disambiguator between two people with
// the same name, so it stays visible under the name rather than replacing it.
//
// `md` is the same contact one size up, for somewhere it is the subject rather than one
// row of many: a chip's menu is about that person, so it leads with them. `sm` takes the
// name from whatever the row sets, which is how every picker has always sized it.
//
// `query` is what has been typed, marked where it appears in the name and the address: the row
// shows why it matched, and two rows under one name differ where the typing landed.
// `domainTellsApart` is set where another row carries the same name: the address's domain is then
// what tells the two apart, and it reads as dark as the name.
const {
  contact,
  query = '',
  domainTellsApart = false,
} = defineProps<{
  contact: DraftRecipient
  size?: 'sm' | 'md'
  query?: string
  domainTellsApart?: boolean
}>()

/** The address's parts, with the domain marked when it is what tells this contact apart. */
const addressParts = computed(() => {
  const at = contact.email.lastIndexOf('@')
  // Typing across the @ marks the whole address as one match; the split would lose it.
  if (!domainTellsApart || at < 0 || query.includes('@'))
    return highlight(contact.email).map((p) => ({ ...p, domain: false }))
  return [
    ...highlight(contact.email.slice(0, at)).map((p) => ({ ...p, domain: false })),
    ...highlight(contact.email.slice(at)).map((p) => ({ ...p, domain: true })),
  ]
})

/** `text` split around the first case-insensitive occurrence of the query. */
const highlight = (text: string) => {
  const needle = query.trim()
  // Matched case-insensitively in the text itself, never in a lowercased copy: lowercasing can
  // change a string's length ("İ" becomes two characters), which would shift the marked letters.
  const found = needle
    ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').exec(text)
    : null
  if (!found) return [{ text, match: false }]
  const end = found.index + found[0].length
  return [
    { text: text.slice(0, found.index), match: false },
    { text: text.slice(found.index, end), match: true },
    { text: text.slice(end), match: false },
  ].filter((part) => part.text)
}
</script>
