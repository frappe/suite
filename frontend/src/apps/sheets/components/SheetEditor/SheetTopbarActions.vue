<template>
  <!-- The editor's app actions: Ask AI, File, the compact "…" menu, Notes,
  Keyboard shortcuts and who else is here. Rendered in the editor's own top
  bar or, on /d/, in the Drive document header. -->
  <!-- AI Assist entry point — shown only when an admin has configured a
     key and enabled it (gated server-side via the boot flag). -->
  <template v-if="aiEnabled && !readOnly">
    <span class="sn-wide-only">
      <Button
        variant="ghost"
        size="sm"
        icon="lucide-sparkles"
        label="Ask AI"
        tooltip="Ask AI to work on your selection"
        @click="emit('ask-ai')"
      />
    </span>
    <span class="sn-topbar-divider" aria-hidden="true" />
  </template>
  <span class="sn-wide-only">
    <Dropdown :options="fileDropdownOptions" align="end">
      <template #default="{ open }">
        <Button
          :variant="open ? 'subtle' : 'ghost'"
          size="sm"
          icon-left="lucide-file-text"
          icon-right="lucide-chevron-down"
          label="File"
          tooltip="Import / export"
        />
      </template>
    </Dropdown>
  </span>
  <!-- A narrow bar folds Ask AI, File and Keyboard shortcuts into one
     menu. A container query swaps the two, so nothing moves on load. -->
  <span class="sn-compact-only">
    <Dropdown :options="compactMenuOptions" align="end">
      <template #default="{ open }">
        <Button
          :variant="open ? 'subtle' : 'ghost'"
          size="sm"
          icon="lucide-ellipsis"
          aria-label="More actions"
          tooltip="More actions"
        />
      </template>
    </Dropdown>
  </span>
  <span class="sn-topbar-divider" aria-hidden="true" />
  <!-- Notes: button toggles the side panel listing all notes across sheets.
     Shift+F2 still opens the per-cell inline editor for quick capture. -->
  <span class="sn-notes-btn-wrap">
    <Button
      :variant="notesOpen ? 'subtle' : 'ghost'"
      size="sm"
      icon="lucide-sticky-note"
      :aria-label="notesCount ? `Notes (${notesCount})` : 'Notes'"
      :aria-pressed="notesOpen"
      :tooltip="`Notes${notesCount ? ` (${notesCount})` : ''} — Shift+F2 to add`"
      @click="emit('toggle-notes')"
    />
    <span v-if="notesCount" class="sn-notes-badge">{{ notesCount > 9 ? '9+' : notesCount }}</span>
  </span>
  <span class="sn-wide-only">
    <Button
      aria-label="Keyboard shortcuts"
      variant="ghost"
      size="sm"
      icon="lucide-help-circle"
      tooltip="Keyboard shortcuts"
      @click="emit('shortcuts')"
    />
  </span>
  <span class="sn-topbar-divider" aria-hidden="true" />
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
// The top-bar actions, extracted from SheetEditor/index.vue. It renders the
// menus the editor builds and reports clicks back; the editor keeps the
// hidden CSV / XLSX file inputs that the File menu clicks.
import { Avatar, Button, Dropdown, type DropdownOptions } from 'frappe-ui'

type PresentUser = {
  user: string
  initials: string
  user_image?: string | null
  full_name: string
  sub_sheet?: string
  color: string
}

defineProps<{
  aiEnabled: boolean
  readOnly: boolean
  fileDropdownOptions: DropdownOptions
  compactMenuOptions: DropdownOptions
  notesOpen: boolean
  notesCount: number
  presentUsers: PresentUser[]
  currentSheet: string
}>()
const emit = defineEmits<{
  'ask-ai': []
  'toggle-notes': []
  shortcuts: []
}>()
</script>

<style scoped>
/* Hairline between action buttons and avatar — groups the cluster without
   relying on extra padding. */
.sn-topbar-divider {
  width: 1px;
  height: 20px;
  background: var(--outline-gray-2);
  margin: 0 4px;
  flex-shrink: 0;
}
.sn-wide-only {
  display: inline-flex;
}
.sn-compact-only {
  display: none;
}
/* A narrow bar, down to a 320 px phone, keeps every action on one row: labels
   and dividers go, and Ask AI, File and Keyboard shortcuts fold into one menu. */
@container sn-topbar (max-width: 640px) {
  .sn-wide-only,
  .sn-topbar-divider {
    display: none;
  }
  .sn-compact-only {
    display: inline-flex;
  }
}
/* Notes count badge — workbook-wide teal badge on the notes icon. */
.sn-notes-btn-wrap {
  position: relative;
  display: inline-flex;
}
.sn-notes-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  box-sizing: border-box;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  color: #fff;
  background: #0d7490;
  border-radius: 999px;
  border: 1.5px solid var(--surface-base);
  pointer-events: none;
}

/* Presence avatars — stacked/overlapping, each with a white ring so they
   visually separate even when colors are similar. */
.sn-presence {
  display: inline-flex;
  align-items: center;
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
