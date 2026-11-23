<template>
  <div v-if="open" class="sn-sp-pop" :style="style" @click.stop>
    <div class="sn-sp-header">Separator</div>
    <button
      v-for="o in OPTIONS"
      :key="o.value"
      class="sn-sp-item"
      :class="{ 'sn-sp-item-active': o.value === selected && !customActive }"
      @click="onChoose(o.value)"
    >
      <span class="sn-sp-check" aria-hidden="true">
        <svg
          v-if="o.value === selected && !customActive"
          viewBox="0 0 16 16"
          width="14"
          height="14"
        >
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="sn-sp-label">{{ o.label }}</span>
    </button>

    <div class="sn-sp-custom" :class="{ 'sn-sp-item-active': customActive }">
      <span class="sn-sp-check" aria-hidden="true">
        <svg v-if="customActive" viewBox="0 0 16 16" width="14" height="14">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="sn-sp-label">Custom</span>
      <FormControl
        ref="customInputRef"
        v-model="customValue"
        type="text"
        size="sm"
        placeholder="e.g. ::"
        class="sn-sp-custom-input"
        @click.stop
      />
    </div>

    <div class="sn-sp-actions">
      <Button size="sm" variant="ghost" label="Cancel" @click="$emit('cancel')" />
      <Button size="sm" variant="solid" label="Apply" @click="$emit('apply')" />
    </div>
  </div>
</template>

<script setup>
import { Button, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  anchor: { type: Object, default: null },
  selected: { type: String, default: 'auto' },
})
const emit = defineEmits(['choose', 'apply', 'cancel'])

const OPTIONS = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'comma', label: 'Comma' },
  { value: 'semicolon', label: 'Semicolon' },
  { value: 'period', label: 'Period' },
  { value: 'space', label: 'Space' },
  { value: 'tab', label: 'Tab' },
]

const customValue = ref('')
const customActive = ref(false)
const customInputRef = ref(null)

// Suppress the customValue watcher during programmatic clears (e.g. when
// the user picks a named separator like "Comma" we wipe the custom field
// to reset its UI state — without this flag the watcher would fire with
// v='' and emit('choose','auto') a beat after our own emit, overriding
// the user's actual pick.
let _suppressCustomWatch = false
function _clearCustomSilently() {
  _suppressCustomWatch = true
  customValue.value = ''
  queueMicrotask(() => {
    _suppressCustomWatch = false
  })
}

watch(
  () => props.open,
  (v) => {
    if (!v) {
      _clearCustomSilently()
      customActive.value = false
    }
  },
)

function onChoose(value) {
  customActive.value = false
  _clearCustomSilently()
  emit('choose', value)
}

// Watch the bound ref directly instead of @input on the FormControl —
// frappe-ui's FormControl emits `input` slightly before its v-model
// flush, so reading customValue.value inside an @input handler can see
// the *previous* value and silently fall through to the 'auto' branch.
// The watcher fires AFTER customValue is up to date, so the dot the user
// just typed always reaches `_previewSplit` as the custom separator.
watch(customValue, (v) => {
  if (_suppressCustomWatch) return
  if (!v) {
    customActive.value = false
    emit('choose', 'auto')
    return
  }
  customActive.value = true
  emit('choose', { kind: 'custom', value: v })
})

const style = computed(() => {
  if (!props.anchor) return { display: 'none' }
  return { left: `${props.anchor.x + 4}px`, top: `${props.anchor.y + 4}px` }
})
</script>

<style scoped>
.sn-sp-pop {
  position: absolute;
  background: var(--surface-base, #ffffff);
  border: 1px solid var(--outline-gray-2, #e5e5e5);
  border-radius: 8px;
  box-shadow: 0 4px 12px -4px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 40;
  min-width: 232px;
  display: flex;
  flex-direction: column;
  animation: sn-pop-rise 120ms ease-out;
  transform-origin: top left;
}
@keyframes sn-pop-rise {
  from {
    transform: translateY(-4px) scale(0.98);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

.sn-sp-header {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--ink-gray-5, #737373);
  padding: 8px 10px 6px;
}

.sn-sp-item,
.sn-sp-custom {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 6px;
  background: transparent;
  border: 0;
  font: inherit;
  color: var(--ink-gray-8, #262626);
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  border-radius: 4px;
}
.sn-sp-item {
  cursor: pointer;
}
.sn-sp-item:hover {
  background: var(--surface-gray-2, #f5f5f5);
}
.sn-sp-item-active {
  color: var(--ink-gray-9, #171717);
}

.sn-sp-check {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-gray-7, #525252);
}
.sn-sp-label {
  flex-shrink: 0;
}

.sn-sp-custom-input {
  flex: 1;
  min-width: 0;
  margin-left: auto;
  max-width: 130px;
}

/* Footer divider matches the menu's inner padding rhythm; ghost+solid Frappe
   UI Buttons render in their canonical sizes — no custom button styles. */
.sn-sp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 4px 4px;
  margin-top: 4px;
  border-top: 1px solid var(--outline-gray-2, #e5e5e5);
}
</style>
