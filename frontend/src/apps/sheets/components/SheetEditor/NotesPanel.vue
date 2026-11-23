<template>
  <!-- Notes side panel — Google-Sheets-style global list. Lives inside
     sn-grid-wrap so it docks the same right edge as Version History. -->
  <aside class="sn-notes-panel" @click.stop>
    <header class="sn-notes-header">
      <div class="sn-notes-title">
        Notes
        <span v-if="count" class="sn-notes-count">· {{ count }}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon="lucide-x"
        aria-label="Close notes"
        @click="emit('close')"
      />
    </header>
    <div class="sn-notes-toolbar">
      <Button
        size="sm"
        variant="subtle"
        icon-left="lucide-plus"
        :label="`Add note to ${activeCell}`"
        @click="emit('add')"
      />
    </div>
    <div v-if="!count" class="sn-notes-empty">
      <div class="sn-notes-empty-title">No notes yet.</div>
      <div class="sn-notes-empty-hint">
        Select a cell and press <KeyboardShortcut combo="Shift+F2" />, or use the button above.
        Notes appear here once added.
      </div>
    </div>
    <div v-else class="sn-notes-list">
      <div v-for="g in groups" :key="g.sheet" class="sn-notes-group">
        <div class="sn-notes-group-h">{{ g.sheet }}</div>
        <div
          v-for="n in g.items"
          :key="g.sheet + ':' + n.id"
          class="sn-notes-row"
          :class="{ 'sn-notes-row-active': n.sheet === currentSheet && n.id === activeCell }"
          @click="emit('jump', n)"
        >
          <div class="sn-notes-row-ref">{{ n.id }}</div>
          <div class="sn-notes-row-text">{{ n.text }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
// The notes side panel, extracted from SheetEditor/index.vue. It renders the
// list useNotesPanel.js builds and reports clicks back.
import { Button, KeyboardShortcut } from 'frappe-ui'

type Note = { sheet: string; id: string; text: string; resolved: boolean }

defineProps<{
  groups: { sheet: string; items: Note[] }[]
  count: number
  activeCell: string
  currentSheet: string
}>()
const emit = defineEmits<{ close: []; add: []; jump: [note: Note] }>()
</script>

<style scoped>
/* Notes side panel — docks the right edge of sn-grid-wrap, same dock as
   Version History (only one of the two is open at a time). */
.sn-notes-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 300px;
  background: var(--surface-base);
  border-left: 1px solid var(--outline-gray-2);
  display: flex;
  flex-direction: column;
  z-index: 30;
  box-shadow: -4px 0 12px -8px rgba(0, 0, 0, 0.08);
  animation: sn-notes-slide-in 160ms cubic-bezier(0.2, 0.8, 0.25, 1);
}
@keyframes sn-notes-slide-in {
  from {
    transform: translateX(16px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.sn-notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--outline-gray-2);
}
.sn-notes-title {
  font-weight: 600;
  color: var(--ink-gray-8);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.sn-notes-count {
  font-weight: 400;
  color: var(--ink-gray-5);
  font-size: 12px;
}
.sn-notes-toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--outline-gray-2);
}
.sn-notes-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--ink-gray-5);
}
.sn-notes-empty-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-gray-7);
  margin-bottom: 6px;
}
.sn-notes-empty-hint {
  font-size: 12px;
  line-height: 1.5;
}
.sn-notes-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 12px;
}
.sn-notes-group {
  padding: 4px 0;
}
.sn-notes-group-h {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--ink-gray-5);
  padding: 8px 16px 4px;
  text-transform: uppercase;
}
.sn-notes-row {
  padding: 8px 12px;
  margin: 1px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.12s;
}
.sn-notes-row:hover {
  background: var(--surface-gray-2);
}
.sn-notes-row-active {
  background: var(--surface-gray-2);
  box-shadow: inset 2px 0 0 var(--ink-gray-7);
}
.sn-notes-row-ref {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-gray-8);
  font-variant-numeric: tabular-nums;
}
.sn-notes-row-text {
  font-size: 12px;
  color: var(--ink-gray-6);
  margin-top: 2px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
</style>
