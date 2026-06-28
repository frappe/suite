<template>
  <Dialog
    v-model:open="open"
    title="Settings"
    @close="model = false"
  >
    <Tabs v-model="tabIndex" :tabs>
        <template #tab-panel>
          <Form>
            <template #default="{ dirty, setDirty, error }">
              <div class="overflow-y-auto max-h-96 px-2 pt-3">
                <div class="flex flex-col gap-4 pb-5 pr-5">
                  <div class="space-y-1.5">
                    <FormLabel label="Font Family" />
                    <FontSelect
                      v-model="settings.font_family"
                      variant="subtle"
                      :options="fontOptions"
                    />
                    <div class="text-xs text-ink-gray-5">
                      {{
                        `Choose the default font family for ${
                          tabIndex === 1 ? 'this document' : 'new documents'
                        }.`
                      }}
                    </div>
                  </div>
                  <FormControl
                    v-model="settings.font_size"
                    type="number"
                    label="Font Size"
                    autocomplete="off"
                    placeholder="Automatic"
                    description="Set the font size of the editor (px)."
                  />
                  <FormControl
                    v-model="settings.line_height"
                    type="number"
                    label="Line Height"
                    autocomplete="off"
                    placeholder="Automatic"
                    description="Set the line height of the editor."
                  />
                  <div class="space-y-1.5">
                    <FormLabel label="Paragraph Spacing" />
                    <div class="grid grid-cols-2 gap-2">
                      <FormControl
                        v-model.number="settings.paragraph_spacing_before"
                        type="number"
                        placeholder="0"
                        :min="0"
                        :step="1"
                        autocomplete="off"
                        description="Above"
                      />
                      <FormControl
                        v-model.number="settings.paragraph_spacing_after"
                        type="number"
                        placeholder="0"
                        :min="0"
                        autocomplete="off"
                        :step="1"
                        description="Below"
                      />
                    </div>
                    <div class="text-xs text-ink-gray-5">
                      Set the default spacing around paragraphs.
                    </div>
                  </div>
                </div>

                <!-- Print Settings Section -->
                <div class="flex flex-col gap-3 pb-5 pr-5">
                  <template v-if="tabIndex === 1">
                    <h3 class="text-sm-medium text-ink-gray-7">Print Settings</h3>
                    <div class="space-y-2">
                      <FormLabel label="Header & Footer" />
                      <div class="grid grid-cols-2 gap-2">
                        <FormControl
                          v-model="settings.print_header_left"
                          type="text"
                          placeholder="Header Left"
                          description="Top Left"
                          autocomplete="off"
                        />
                        <FormControl
                          v-model="settings.print_header_right"
                          type="text"
                          placeholder="Header Right"
                          description="Top Right"
                          autocomplete="off"
                        />
                        <FormControl
                          v-model="settings.print_footer_left"
                          type="text"
                          placeholder="Footer Left"
                          description="Bottom Left"
                          autocomplete="off"
                        />
                        <FormControl
                          v-model="settings.print_footer_right"
                          :disabled="settings.print_show_pages"
                          type="text"
                          placeholder="Footer Right"
                          description="Bottom Right"
                          autocomplete="off"
                        />
                      </div>
                      <div class="text-xs text-ink-gray-5 mt-2">
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
                      <FormControl
                        v-model="settings.apply_watermark"
                        type="checkbox"
                        label="Apply watermark to PDF"
                        :description="'Enable this to automatically apply watermark when downloading PDF for this document.'"
                      />
                    </div>
                  </template>
                  <template v-else>
                    <h3 class="text-sm-medium text-ink-gray-7">Watermark</h3>
                    <FormControl
                      v-model="settings.watermark_text"
                      type="text"
                      label="Text"
                      placeholder="Your company name.."
                      :description="`Set the text for the watermark.`"
                    />
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormControl
                        v-model.number="settings.watermark_size"
                        type="number"
                        label="Size"
                        placeholder="40"
                        :min="10"
                        :max="300"
                        :step="5"
                        :description="`Set the watermark text size (px).`"
                        class="w-full"
                      />
                      <FormControl
                        v-model.number="settings.watermark_angle"
                        type="number"
                        label="Angle"
                        placeholder="-45"
                        :min="-180"
                        :max="180"
                        :step="15"
                        :description="`Set the watermark text angle (°).`"
                        class="w-full"
                      />
                    </div>
                  </template>
                </div>
              </div>
              <div class="mt-2">
                <div v-if="error" class="text-xs text-ink-red-8">
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
const tabs = dynamicList([
  { label: 'Everywhere', icon: LucideGlobe2 },
  { label: 'This document', icon: LucideFileText },
])
const tabIndex = ref(props.editable ? 1 : 0)

const fontOptions = computed(() =>
  dynamicList([
    {
      label: 'Automatic',
      value: 'global',
      key: 'global',
      cond: tabIndex.value === 1,
    },
    ...FONT_FAMILIES,
  ]),
)

const resource = computed(() => (tabIndex.value === 1 ? props.docSettings : props.globalSettings))
const key = computed(() => (tabIndex.value === 1 ? 'settings' : 'writer_settings'))

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
  ...(tabIndex.value === 0
    ? ['watermark_text', 'watermark_size', 'watermark_angle']
    : ['apply_watermark']),
])

const settings = reactive({})

const LOCAL_ONLY = [
  'print_header_left',
  'print_header_right',
  'print_footer_left',
  'print_footer_right',
]
const BOOLS = [
  'apply_watermark',
  'print_header_separator',
  'print_footer_separator',
  'print_show_pages',
]
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
