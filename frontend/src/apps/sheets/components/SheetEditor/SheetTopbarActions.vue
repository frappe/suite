<template>
  <!-- Who else is here, beside the header's Comments, Versions and Share. The
  editor's other actions (Ask AI, File, Notes, Keyboard shortcuts) are in the
  menu bar. Rendered in the editor's own top bar or, on /d/, in the Drive
  document header. -->
  <!-- Presence avatars — other users currently in the workbook.
     Outline = their cursor color; tooltip says which sub-sheet
     they're on so cross-sheet collaborators are discoverable. -->
  <div v-if="presentUsers.length" class="sn-presence">
    <Avatar
      v-for="u in presentUsers.slice(0, 3)"
      :key="u.user"
      :label="u.initials"
      :image="u.user_image || undefined"
      size="sm"
      :tooltip="
        u.sub_sheet && u.sub_sheet !== currentSheet
          ? `${u.full_name} — on ${u.sub_sheet}`
          : u.full_name
      "
      class="sn-presence-avatar"
      :style="{ '--rc': u.color }"
    />
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
import { Avatar } from 'frappe-ui'

type PresentUser = {
  user: string
  initials: string
  user_image?: string | null
  full_name: string
  sub_sheet?: string
  color: string
}

defineProps<{
  presentUsers: PresentUser[]
  currentSheet: string
}>()
</script>

<style scoped>
/* Presence avatars — stacked/overlapping, each with a white ring so they
   visually separate even when colors are similar. */
.sn-presence {
  display: inline-flex;
  align-items: center;
  margin-right: 4px;
}
.sn-presence-avatar {
  margin-left: -6px;
  border-radius: 50%;
  /* Outer ring = surface bg so the stack reads as overlapping pebbles;
     inner ring = the peer's cursor color so the avatar matches their
     cursor outline at a glance. `box-shadow` stacks two rings without
     pushing layout. */
  box-shadow:
    0 0 0 2px var(--surface-base),
    0 0 0 4px var(--rc, var(--outline-gray-2));
}
.sn-presence-avatar:first-child {
  margin-left: 0;
}
.sn-presence-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--surface-gray-3);
  border: 2px solid var(--surface-base);
  margin-left: -6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ink-gray-7);
  flex-shrink: 0;
  cursor: default;
}
</style>
