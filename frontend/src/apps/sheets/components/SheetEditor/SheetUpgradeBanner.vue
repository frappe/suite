<template>
  <Alert
    v-if="description"
    class="sn-upgrade-banner"
    :theme="upgrade.ok ? 'blue' : 'red'"
    :title="title"
    :description="description"
    dismissible
    @dismiss="emit('close')"
  />
</template>

<script setup lang="ts">
// Shown once, on the open that converted a sheet last saved by the develop
// editor or just imported from a file (usePersistence.js `legacyUpgrade`). The
// next open loads the IronCalc copy and has nothing to say. An import that came
// across cleanly has nothing to say either.
import { Alert } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { UnknownFormula } from '../../utils/legacy-sheet'

const props = defineProps<{
  upgrade: {
    ok: boolean
    save: boolean
    importedFrom?: string
    renamed: Record<string, string>
    skipped: number
    unknown: UnknownFormula[]
  }
  readOnly: boolean
}>()
const emit = defineEmits<{ close: [] }>()

// Cells named in the #NAME? list before it says "and N more".
const LISTED = 5

const title = computed(() => {
  const source = props.upgrade.importedFrom
  if (source) {
    return props.upgrade.ok
      ? __('Imported from {0}', [source])
      : __("{0} couldn't be converted to a sheet", [source])
  }
  if (!props.upgrade.ok) return __("This sheet's data from the old editor couldn't be opened")
  if (props.upgrade.save && !props.readOnly) return __('This sheet was upgraded to the new editor')
  return __('This sheet was made in the old editor')
})

const upgradeAdvice = computed(() =>
  props.upgrade.save && !props.readOnly
    ? __(
        'If anything looks wrong, restore "Before upgrade" from version history and tell us about it.',
      )
    : __("You're seeing it converted. It's upgraded when someone who can edit it opens it."),
)

const description = computed(() => {
  const u = props.upgrade
  if (!u.ok && u.importedFrom) {
    return __(
      "It's shown read-only and nothing was saved. The original file is still in Drive. Please tell us about this file so we can fix it.",
    )
  }
  if (!u.ok) {
    return __(
      "It's shown read-only and nothing was changed. Please tell us about this sheet so we can fix it.",
    )
  }
  const parts = u.importedFrom ? [] : [upgradeAdvice.value]
  if (u.unknown.length) {
    const cells = u.unknown.slice(0, LISTED).map((f) => `${f.sheet}!${f.cell}`)
    const more = u.unknown.length - cells.length
    parts.push(
      more
        ? __('{0} formulas use functions Sheets does not have and show #NAME?: {1} and {2} more.', [
            u.unknown.length,
            cells.join(', '),
            more,
          ])
        : __('Formulas that use functions Sheets does not have show #NAME?: {0}.', [
            cells.join(', '),
          ]),
    )
  }
  const renamed = Object.entries(u.renamed)
  if (renamed.length) {
    parts.push(
      __('Sheet names that are not allowed were changed: {0}.', [
        renamed.map(([from, to]) => `${from} → ${to}`).join(', '),
      ]),
    )
  }
  if (u.skipped) {
    parts.push(__('{0} cells outside the grid were left out.', [u.skipped]))
  }
  return parts.join(' ')
})
</script>

<style scoped>
.sn-upgrade-banner {
  flex-shrink: 0;
  margin: 8px 16px 0;
}
</style>
