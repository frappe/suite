<template>
  <!-- Who else is here, beside the header's Share. The
  editor's other actions (Ask AI, File, Notes, Keyboard shortcuts) are in the
  menu bar. Rendered in the Drive document header on /d/. -->
  <!-- Other users currently in the workbook, drawn as in Writer: a photo, or
     initials in the person's tint and ink. The tooltip says which sub-sheet
     they're on so cross-sheet collaborators are discoverable. -->
  <div v-if="presentUsers.length" class="sn-presence">
    <Tooltip
      v-for="u in presentUsers.slice(0, 3)"
      :key="u.user"
      :text="
        u.sub_sheet && u.sub_sheet !== currentSheet
          ? `${u.full_name} — on ${u.sub_sheet}`
          : u.full_name
      "
    >
      <Avatar
        v-if="u.user_image"
        :label="u.initials"
        :image="u.user_image"
        size="sm"
        class="sn-presence-avatar"
      />
      <span v-else class="sn-presence-initials sn-peer" :style="colourStyle(u.colour)">
        {{ u.initials }}
      </span>
    </Tooltip>
    <span
      v-if="presentUsers.length > 3"
      class="sn-presence-more"
      :title="`${presentUsers.length - 3} more people`"
      >+{{ presentUsers.length - 3 }}</span
    >
  </div>
</template>

<script setup lang="ts">
// The top-bar actions, extracted from SheetEditor/index.vue: the presence
// avatars. The editor keeps the hidden CSV / XLSX file inputs that File →
// Import clicks.
import { Avatar, Tooltip } from 'frappe-ui'

import { colourStyle, type PeerColour } from '@/platform/collab/colours'

type PresentUser = {
  user: string
  initials: string
  user_image?: string | null
  full_name: string
  sub_sheet?: string
  colour: PeerColour
}

defineProps<{
  presentUsers: PresentUser[]
  currentSheet: string
}>()
</script>

<style scoped>
.sn-presence {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
}
.sn-presence-avatar {
  border-radius: 50%;
}
.sn-presence-initials,
.sn-presence-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;
  cursor: default;
}
/* Drawn like the person's name flag: their tint, their name's ink. */
.sn-presence-initials {
  background-color: var(--rc-tint);
  color: var(--rc-ink);
}
.sn-presence-more {
  background: var(--surface-gray-2);
  color: var(--ink-gray-5);
}
</style>
