<template>
  <Dialog
    v-model:open="open"
    title="Settings"
    @close="model = false"
  >
    <Tabs v-model="tab" :tabs>
        <template #tab-panel>
          <Form>
            <template #default="{ dirty, setDirty, error }">
              <div class="overflow-y-auto max-h-96 px-2 pt-3">
                <div class="flex flex-col gap-4 pb-5 pr-5">
                  <FontSelect
                    v-model="settings.font_family"
                    variant="subtle"
                    :options="fontOptions"
                    label="Font family"
                    :description="`Choose the default font family for ${
                      tab === 'doc' ? 'this document' : 'new documents'
                    }.`"
                  />
                  <FormControl
                    v-model="settings.font_size"
                    type="number"
                    label="Font size"
                    autocomplete="off"
                    placeholder="Automatic"
                    description="Set the font size of the editor (px)."
                  />
                  <FormControl
                    v-model.number="lineSpacing"
                    type="number"
                    label="Line spacing"
                    autocomplete="off"
                    :min="0.5"
                    :step="0.05"
                    placeholder="Automatic"
                    description="A multiple of single spacing, like 1.15 or 1.5."
                  />
                  <div class="space-y-1.5">
                    <FormLabel label="Paragraph spacing" size="md" />
                    <div class="grid grid-cols-2 gap-2">
                      <FormControl
                        v-model.number="settings.paragraph_spacing_before"
                        type="number"
                        placeholder="0"
                        :min="0"
                        :step="1"
                        autocomplete="off"
                        label="Above"
                      />
                      <FormControl
                        v-model.number="settings.paragraph_spacing_after"
                        type="number"
                        placeholder="0"
                        :min="0"
                        autocomplete="off"
                        :step="1"
                        label="Below"
                      />
                    </div>
                    <div class="text-p-sm text-ink-gray-5">
                      Set the default spacing around paragraphs.
                    </div>
                  </div>
                </div>

                <!-- Print Settings Section -->
                <div v-if="tab === 'doc'" class="flex flex-col gap-3 pb-5 pr-5">
                    <h3 class="text-base font-medium text-ink-gray-7">Print settings</h3>
                    <div class="space-y-2">
                      <FormLabel label="Header & footer" size="md" />
                      <div class="grid grid-cols-2 gap-2">
                        <FormControl
                          v-model="settings.print_header_left"
                          type="text"
                          placeholder="Header left"
                          label="Top left"
                          autocomplete="off"
                        />
                        <FormControl
                          v-model="settings.print_header_right"
                          type="text"
                          placeholder="Header right"
                          label="Top right"
                          autocomplete="off"
                        />
                        <FormControl
                          v-model="settings.print_footer_left"
                          type="text"
                          placeholder="Footer left"
                          label="Bottom left"
                          autocomplete="off"
                        />
                        <FormControl
                          v-model="settings.print_footer_right"
                          :disabled="settings.print_show_pages"
                          type="text"
                          placeholder="Footer right"
                          label="Bottom right"
                          autocomplete="off"
                        />
                      </div>
                      <div class="text-p-sm text-ink-gray-5 mt-2">
                        Set the text to appear in headers and footers when printing.
                      </div>
                    </div>
                    <div class="flex flex-col gap-3">
                      <FormControl
                        v-model="settings.print_show_pages"
                        type="checkbox"
                        label="Show page numbers"
                        description="Add a line below the header when printing."
                      />
                      <FormControl
                        v-model="settings.print_header_separator"
                        type="checkbox"
                        label="Header separator line"
                        description="Add a line below the header when printing."
                      />
                      <FormControl
                        v-model="settings.print_footer_separator"
                        type="checkbox"
                        label="Footer separator line"
                        description="Add a line above the footer when printing."
                      />
                    </div>
                </div>
              </div>
              <div class="mt-2">
                <div v-if="error" class="text-p-sm text-ink-red-6">
                  {{ error }}
                </div>
                <Button
                  label="Update"
                  variant="solid"
                  class="w-full mt-3"
                  :disabled="!dirty || error"
                  :loading="resource.loading"
                  @click="
                    () => {
                      if (key === 'writer_settings') resource.setValue.submit({ [key]: settings })
                      else {
                        resource.updateSettings.submit({
                          data: JSON.stringify(settings),
                        })
                        Object.assign(resource.doc.settings, settings)
                      }
                      setDirty(false)
                    }
                  "
                />
              </div>
            </template>
          </Form>
        </template>
      </Tabs>
  </Dialog>
</template>

<script setup>
import { computed, ref, reactive, watchEffect } from 'vue'
import { Button, FormControl, Dialog, Tabs, FormLabel } from 'frappe-ui'
import { FONT_FAMILIES, dynamicList } from '@/apps/writer/utils/'
import { toCssLineHeight, toLineSpacing } from '@/apps/writer/utils/typography'
import Form from '@/apps/writer/components/Form.vue'
import FontSelect from './FontSelect.vue'
import LucideFileText from '~icons/lucide/file-text'
import LucideGlobe2 from '~icons/lucide/globe-2'

const open = ref(true)
const model = defineModel()

const props = defineProps({
  docSettings: { required: true, type: Object },
  globalSettings: { required: true, type: Object },
  editable: Boolean,
})
// iconLeft, not icon: `icon` makes an icon-only trigger and drops the label.
const tabs = dynamicList([
  { value: 'global', label: 'Everywhere', iconLeft: LucideGlobe2 },
  { value: 'doc', label: 'This document', iconLeft: LucideFileText },
])
const tab = ref(props.editable ? 'doc' : 'global')

const fontOptions = computed(() =>
  dynamicList([
    {
      label: 'Automatic',
      value: 'global',
      key: 'global',
      cond: tab.value === 'doc',
    },
    ...FONT_FAMILIES,
  ]),
)

const resource = computed(() => (tab.value === 'doc' ? props.docSettings : props.globalSettings))
const key = computed(() => (tab.value === 'doc' ? 'settings' : 'writer_settings'))

const KEYS = computed(() => [
  'font_family',
  'font_size',
  'line_height',
  'paragraph_spacing_before',
  'paragraph_spacing_after',
  'print_header_left',
  'print_header_right',
  'print_footer_left',
  'print_footer_right',
  'print_show_pages',
  'print_header_separator',
  'print_footer_separator',
])

const settings = reactive({})

// Stored as a CSS line-height; shown as a Google Docs style multiple of single
// spacing so the number behaves the way users expect.
const lineSpacing = computed({
  get: () =>
    settings.line_height && settings.line_height !== 'global'
      ? toLineSpacing(settings.line_height)
      : '',
  set: (value) => {
    settings.line_height = value ? toCssLineHeight(value) : 'global'
  },
})

const LOCAL_ONLY = [
  'print_header_left',
  'print_header_right',
  'print_footer_left',
  'print_footer_right',
]
const BOOLS = ['print_header_separator', 'print_footer_separator', 'print_show_pages']
watchEffect(() => {
  const base = { ...resource.value.doc[key.value] }
  for (const k of KEYS.value) {
    if (BOOLS.includes(k)) {
      settings[k] = base[k] === true
    } else {
      settings[k] = LOCAL_ONLY.includes(k) ? base[k] : base[k] || 'global'
    }
  }
})
</script>
