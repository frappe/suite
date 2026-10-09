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
      <template v-for="(part, i) in highlight(contact.email)" :key="i">
        <span v-if="part.match" class="text-ink-gray-8 !font-medium">{{ part.text }}</span>
        <template v-else>{{ part.text }}</template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
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
const { query = '' } = defineProps<{
  contact: DraftRecipient
  size?: 'sm' | 'md'
  query?: string
}>()

/** `text` split around the first case-insensitive occurrence of the query. */
const highlight = (text: string) => {
  const needle = query.trim().toLowerCase()
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at < 0) return [{ text, match: false }]
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, at + needle.length), match: true },
    { text: text.slice(at + needle.length), match: false },
  ].filter((part) => part.text)
}
</script>
