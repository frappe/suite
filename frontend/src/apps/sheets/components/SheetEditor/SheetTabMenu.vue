<template>
  <!-- Sheet-tab menu (rename / duplicate / protect / delete), opened from a
  tab's chevron or right-click. -->
  <div class="sn-ctx-menu" :style="{ left: menu.x + 'px', bottom: menu.bottom + 'px' }">
    <Button
      variant="ghost"
      size="sm"
      icon-left="lucide-edit-2"
      label="Rename"
      @click="emit('rename')"
    />
    <Button
      variant="ghost"
      size="sm"
      icon-left="lucide-copy"
      label="Duplicate"
      @click="emit('duplicate')"
    />
    <Button
      variant="ghost"
      size="sm"
      :icon-left="locked ? 'lucide-unlock' : 'lucide-lock'"
      :label="locked ? 'Unprotect sheet' : 'Protect sheet'"
      @click="emit('toggle-protect')"
    />
    <Button
      variant="ghost"
      size="sm"
      icon-left="lucide-trash-2"
      label="Delete"
      :disabled="!canDelete"
      @click="emit('delete')"
    />
  </div>
</template>

<script setup lang="ts">
// The sheet-tab menu, extracted from SheetEditor/index.vue. useContextMenu.js
// positions it; the editor's handlers act on the tab it was opened for.
import { Button } from 'frappe-ui'

defineProps<{
  menu: { x: number; bottom: number }
  locked: boolean
  canDelete: boolean
}>()
const emit = defineEmits<{
  rename: []
  duplicate: []
  'toggle-protect': []
  delete: []
}>()
</script>

<style scoped>
/* ── Right-click context menu (positioned at cursor; uses Frappe UI Buttons inside) ── */
.sn-ctx-menu {
  position: fixed;
  z-index: 9000;
  background: var(--surface-elevation-2);
  border: 1px solid var(--outline-elevation-2);
  border-radius: 10px;
  box-shadow:
    0 0 1px rgba(0, 0, 0, 0.35),
    0 6px 8px -4px rgba(0, 0, 0, 0.1);
  padding: 4px;
  min-width: 208px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
}
/* Frappe UI Button defaults to `justify-content:center`. Override inside
   context menus so every row's icon sits at the same left padding and the
   labels line up regardless of length. */
.sn-ctx-menu :deep(button) {
  width: 100%;
  justify-content: flex-start;
  padding-left: 10px;
  padding-right: 10px;
}
.sn-ctx-sep {
  height: 1px;
  background: var(--outline-gray-1);
  margin: 4px 0;
  border: none;
}
</style>
