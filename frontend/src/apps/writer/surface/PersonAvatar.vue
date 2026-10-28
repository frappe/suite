<template>
  <Avatar v-if="image" :image="image" :label="name" size="sm" shape="circle" />
  <span
    v-else
    class="peer-colour inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
    :style="colourStyle(personColour(user))"
    :data-initials="initialsOf(name)"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { Avatar } from 'frappe-ui'

import { colourStyle, personColour } from '@/apps/writer/collab/colours'
import { initialsOf } from '@/apps/writer/collab/peers'

/** A person's photo, or their initials in their own colour, as the people in the header show them. */
defineProps<{ user: string; name: string; image?: string | null }>()
</script>

<style scoped>
.peer-colour {
  background-color: var(--peer-tint);
  color: var(--peer-ink);
}

/* Drawn, not written, so the initials stay out of the row's text that is read or copied */
.peer-colour::before {
  content: attr(data-initials);
}
</style>
