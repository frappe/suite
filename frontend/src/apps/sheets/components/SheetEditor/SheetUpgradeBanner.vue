<template>
  <Alert
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
// editor (usePersistence.js `legacyUpgrade`). The next open loads the
// IronCalc copy and has nothing to say.
import { Alert } from 'frappe-ui'
import { computed } from 'vue'

import type { UnknownFormula } from '../../utils/legacy-sheet'

const props = defineProps<{
  upgrade: {
    ok: boolean
    save: boolean
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
  if (!props.upgrade.ok) return __("This sheet's data from the old editor couldn't be opened")
  if (props.upgrade.save && !props.readOnly) return __('This sheet was upgraded to the new editor')
  return __('This sheet was made in the old editor')
})

const description = computed(() => {
  const u = props.upgrade
  if (!u.ok) {
    return __(
      "It's shown read-only and nothing was changed. Please tell us about this sheet so we can fix it.",
    )
  }
  const parts = [
    u.save && !props.readOnly
      ? __(
          'If anything looks wrong, restore "Before upgrade" from version history and tell us about it.',
        )
      : __("You're seeing it converted. It's upgraded when someone who can edit it opens it."),
  ]
  if (u.unknown.length) {
    const cells = u.unknown.slice(0, LISTED).map((f) => `${f.sheet}!${f.cell}`)
    const more = u.unknown.length - cells.length
    parts.push(
      more
        ? __('{0} formulas use functions the new editor lacks and show #NAME?: {1} and {2} more.', [
            u.unknown.length,
            cells.join(', '),
            more,
          ])
        : __('Formulas that use functions the new editor lacks show #NAME?: {0}.', [
            cells.join(', '),
          ]),
    )
  }
  const renamed = Object.entries(u.renamed)
  if (renamed.length) {
    parts.push(
      __('Sheet names the new editor does not allow were changed: {0}.', [
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
