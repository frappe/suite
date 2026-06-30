<template>
  <div class="ab-wrap" @keydown.esc.stop="emit('close')">
    <div class="ab-card">
      <!-- Input row -->
      <div class="ab-input-row">
        <span class="ab-spark" aria-hidden="true">✨</span>
        <input
          ref="inputRef"
          v-model="text"
          type="text"
          class="ab-input"
          :placeholder="`Ask about ${selectionLabel || 'your selection'}…  e.g. “sum each column below”`"
          :disabled="busy"
          autocomplete="off"
          @keydown.enter="onEnter"
        />
        <Spinner v-if="busy" size="sm" />
        <Button
          v-else
          variant="solid"
          size="sm"
          label="Ask"
          :disabled="!text.trim()"
          @click="onEnter"
        />
        <button type="button" class="ab-close" aria-label="Close" @click="emit('close')">×</button>
      </div>

      <!-- Error -->
      <Badge
        v-if="error"
        theme="red" variant="subtle" size="sm"
        class="ab-msg"
        :label="error"
        :tooltip="error"
      />

      <!-- Read-only answer -->
      <p v-if="answer" class="ab-answer">{{ answer }}</p>

      <!-- Keep / Undo bar for an applied change -->
      <div v-if="pending" class="ab-keep-row">
        <span class="ab-keep-text">
          Applied to {{ pending.count }} cell{{ pending.count === 1 ? '' : 's' }}.
        </span>
        <div class="ab-keep-actions">
          <Button variant="ghost" size="sm" label="Undo" @click="emit('undo')" />
          <Button variant="solid" size="sm" label="Keep" @click="emit('keep')" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { Badge, Spinner } from 'frappe-ui'

defineProps({
  busy:           { type: Boolean, default: false },
  selectionLabel: { type: String,  default: '' },
  error:          { type: String,  default: '' },
  answer:         { type: String,  default: '' },
  // null, or { count } when a change has been applied and awaits Keep/Undo
  pending:        { type: Object,  default: null },
})
const emit = defineEmits(['submit', 'close', 'keep', 'undo'])

const text     = ref('')
const inputRef = ref(null)

function onEnter() {
  const t = text.value.trim()
  if (!t) return
  emit('submit', t)
}

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
})
</script>

<style scoped>
.ab-wrap {
  /* Fixed below the topbar + toolbar (~92px) so it never depends on an
     ancestor's positioning context. */
  position: fixed;
  top: 96px; left: 50%; transform: translateX(-50%);
  z-index: 600; width: min(620px, calc(100vw - 32px));
}
.ab-card {
  background: var(--surface-elevation-2, #fff);
  border: 1px solid var(--outline-gray-2);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .16);
  padding: 10px 12px;
}
.ab-input-row { display: flex; align-items: center; gap: 8px; }
.ab-spark { font-size: 14px; line-height: 1; }
.ab-input {
  flex: 1; min-width: 0;
  border: 0; background: transparent;
  font-size: 14px; color: var(--ink-gray-9); padding: 6px 2px;
}
/* Strip the global focus ring/box-shadow some base styles add to inputs —
   the bordered card is the container, the input itself stays borderless
   (Espresso style). */
.ab-input:focus,
.ab-input:focus-visible {
  outline: none !important;
  box-shadow: none !important;
  border: 0 !important;
}
.ab-input::placeholder { color: var(--ink-gray-4); }
.ab-input:disabled { color: var(--ink-gray-5); }
.ab-close {
  border: 0; background: transparent; cursor: pointer;
  font-size: 18px; line-height: 1; color: var(--ink-gray-5);
  padding: 0 4px; border-radius: 4px;
}
.ab-close:hover { color: var(--ink-gray-8); background: var(--surface-gray-2); }

.ab-msg { display: block; margin: 8px 0 0; max-width: 100%; }
.ab-answer {
  margin: 8px 2px 0; font-size: 13px; line-height: 1.5;
  color: var(--ink-gray-8); white-space: pre-wrap;
}

.ab-keep-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-top: 10px; padding-top: 10px;
  border-top: 1px solid var(--outline-gray-1);
}
.ab-keep-text { font-size: 13px; color: var(--ink-gray-6); }
.ab-keep-actions { display: flex; gap: 8px; }
</style>
