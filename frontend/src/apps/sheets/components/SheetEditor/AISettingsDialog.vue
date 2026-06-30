<template>
  <Dialog v-model="show" :options="{ title: 'AI Assist', size: 'md' }">
    <template #body-content>

      <!-- Inline error banner (permission / network failures). Auto-clears. -->
      <Badge
        v-if="errorMessage"
        theme="red" variant="subtle" size="sm"
        class="ai-error"
        :label="errorMessage"
        :tooltip="errorMessage"
      />

      <div v-if="loading" class="ai-loading"><Spinner size="sm" /></div>

      <template v-else>
        <p class="ai-help">
          Lets people describe what they want in plain words and have it applied
          to the grid. The API key is stored encrypted on the server and is
          never sent back to the browser.
        </p>

        <!-- Enable toggle -->
        <div class="ai-row">
          <div class="ai-row-text">
            <span class="ai-row-title">Enable AI Assist</span>
            <span class="ai-row-sub">Show the “Ask” entry point for everyone on this site.</span>
          </div>
          <Switch v-model="enabled" />
        </div>

        <div class="ai-divider" />

        <!-- API key -->
        <p class="ai-label">Anthropic API key</p>
        <FormControl
          type="password"
          :modelValue="apiKey"
          :placeholder="keyIsSet ? '•••••••••• key on file — leave blank to keep' : 'sk-ant-...'"
          autocomplete="off"
          @update:modelValue="apiKey = $event"
        />
        <p v-if="keyIsSet" class="ai-key-state">A key is currently configured.</p>

        <!-- Model -->
        <p class="ai-label ai-label--gap">Model</p>
        <FormControl
          type="text"
          :modelValue="model"
          placeholder="claude-opus-4-8"
          @update:modelValue="model = $event"
        />
        <p class="ai-key-state">
          Tip: set this to <code>mock</code> for a keyless local demo — sums, averages,
          counts, min/max/median, running totals, % of total, and text transforms
          (uppercase, trim, first/last name, email domain) over a selection. No API key, no spend.
        </p>
      </template>

    </template>

    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button
          variant="solid"
          size="sm"
          label="Save"
          :loading="saving"
          :disabled="loading || saving"
          @click="save"
        />
        <Button variant="outline" size="sm" label="Cancel" @click="show = false" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Badge, Switch, FormControl, Spinner } from 'frappe-ui'
import { call } from '../../utils/api.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const loading  = ref(false)
const saving   = ref(false)
const enabled  = ref(false)
const model    = ref('claude-opus-4-8')
const apiKey   = ref('')          // only sent if the admin types a new key
const keyIsSet = ref(false)       // whether a key is already on file (the real key is never fetched)

const errorMessage = ref('')
function _flashError(err) {
  const msg = (err && err.message) ? String(err.message) : 'Something went wrong'
  errorMessage.value = msg
  setTimeout(() => { if (errorMessage.value === msg) errorMessage.value = '' }, 5000)
}

watch(show, async (open) => {
  if (!open) return
  errorMessage.value = ''
  apiKey.value = ''
  loading.value = true
  try {
    const s = await call('suite.sheets.api.get_ai_settings')
    enabled.value  = !!s.enabled
    model.value    = s.model || 'claude-opus-4-8'
    keyIsSet.value = !!s.keyIsSet
  } catch (err) {
    _flashError(err)
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value = true
  try {
    const s = await call('suite.sheets.api.save_ai_settings', {
      api_key: apiKey.value,                 // '' = keep existing key
      enabled: enabled.value ? 1 : 0,
      model: model.value || '',
    })
    keyIsSet.value = !!s.keyIsSet
    emit('saved', s)
    show.value = false
  } catch (err) {
    _flashError(err)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.ai-error { display: block; margin: 0 0 12px; max-width: 100%; }
.ai-loading { display: flex; justify-content: center; padding: 24px; }
.ai-help { font-size: 13px; color: var(--ink-gray-6); margin: 0 0 16px; line-height: 1.5; }

.ai-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ai-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ai-row-title { font-size: 13px; font-weight: 500; color: var(--ink-gray-9); }
.ai-row-sub { font-size: 12px; color: var(--ink-gray-5); }

.ai-divider { height: 1px; background: var(--outline-gray-1); margin: 16px 0; }

.ai-label { font-size: 13px; font-weight: 500; color: var(--ink-gray-6); margin: 0 0 8px; }
.ai-label--gap { margin-top: 16px; }
.ai-key-state { font-size: 11px; color: var(--ink-gray-5); margin: 6px 0 0; }
</style>
