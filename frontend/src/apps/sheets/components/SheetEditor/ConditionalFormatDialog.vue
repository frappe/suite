<template>
  <Dialog v-model:open="cfDialog.open" title="Conditional formatting" size="sm">
    <template #default>
      <div class="sn-form-stack">
        <!-- Existing rules — click to edit, ✕ to delete. Only shown when
         the active sheet has any rules; otherwise we jump straight to
         the editor for the new rule. -->
        <div v-if="cfRulesForSheet.length" class="sn-cf-rule-list">
          <div class="sn-cf-rule-list-title">Rules on this sheet</div>
          <div
            v-for="r in cfRulesForSheet"
            :key="r.id"
            class="sn-cf-rule-row"
            :class="{ 'sn-cf-rule-row--active': cfDialog.editId === r.id }"
          >
            <button type="button" class="sn-cf-rule-pick" @click="openRule(r.id)">
              {{ cfRuleLabel(r) }}
            </button>
            <Button
              aria-label="Delete rule"
              variant="ghost"
              size="sm"
              icon="lucide-x"
              theme="red"
              tooltip="Delete rule"
              @click="deleteCfRuleById(r.id)"
            />
          </div>
        </div>

        <FormControl
          v-model="cfDialog.kind"
          type="select"
          label="Rule type"
          :options="CF_KIND_OPTIONS"
        />

        <!-- Classic single-colour rule (the original feature). -->
        <template v-if="cfDialog.kind === 'classic'">
          <FormControl
            v-model="cfDialog.condType"
            type="select"
            label="Condition"
            :options="CF_COND_OPTIONS"
          />
          <FormControl
            v-if="!['empty', 'notempty'].includes(cfDialog.condType)"
            v-model="cfDialog.condValue"
            label="Value"
            placeholder="e.g. 0"
          />
          <FormControl
            v-if="cfDialog.condType === 'between'"
            v-model="cfDialog.condValue2"
            label="And"
            placeholder="e.g. 100"
          />
          <div class="sn-cf-fmt">
            <ColorPicker
              v-model="cfDialog.fmtColor"
              allow-default
              default-label="Automatic"
              title="Text colour"
              fallback="#171717"
            >
              <template #trigger="{ toggle, open }">
                <button
                  type="button"
                  class="sn-swatch-btn"
                  :class="{ 'is-open': open }"
                  title="Text colour"
                  @click="toggle()"
                >
                  <FeatherIcon name="type" class="sn-swatch-glyph" />
                  <span
                    class="sn-swatch-underline"
                    :style="{ background: cfDialog.fmtColor || '#171717' }"
                  ></span>
                </button>
              </template>
            </ColorPicker>
            <ColorPicker
              v-model="cfDialog.fmtBg"
              allow-default
              default-label="No fill"
              title="Fill colour"
              fallback="#ffffff"
            >
              <template #trigger="{ toggle, open }">
                <button
                  type="button"
                  class="sn-swatch-btn"
                  :class="{ 'is-open': open }"
                  title="Fill colour"
                  @click="toggle()"
                >
                  <FeatherIcon name="droplet" class="sn-swatch-glyph" />
                  <span
                    class="sn-swatch-underline sn-swatch-fill"
                    :style="{ background: cfDialog.fmtBg || '#ffffff' }"
                  ></span>
                </button>
              </template>
            </ColorPicker>
            <span class="sn-cf-fmt-label">Apply to range: {{ cfRangeLabel }}</span>
          </div>
        </template>

        <!-- Colour scale: 2- or 3-stop gradient mapped across the range's min/max. -->
        <template v-else-if="cfDialog.kind === 'color-scale'">
          <FormControl
            v-model="cfDialog.scaleVariant"
            type="select"
            label="Variant"
            :options="CF_SCALE_VARIANT_OPTIONS"
          />
          <div class="sn-cf-scale">
            <div class="sn-cf-stop">
              <span>Min</span>
              <ColorPicker
                v-model="cfDialog.scaleMin"
                title="Min colour"
                :fallback="cfDialog.scaleMin"
              />
            </div>
            <div v-if="cfDialog.scaleVariant === '3color'" class="sn-cf-stop">
              <span>Mid</span>
              <ColorPicker
                v-model="cfDialog.scaleMid"
                title="Mid colour"
                :fallback="cfDialog.scaleMid"
              />
            </div>
            <div class="sn-cf-stop">
              <span>Max</span>
              <ColorPicker
                v-model="cfDialog.scaleMax"
                title="Max colour"
                :fallback="cfDialog.scaleMax"
              />
            </div>
          </div>
          <div
            class="sn-cf-scale-preview"
            :style="{
              background:
                cfDialog.scaleVariant === '3color'
                  ? `linear-gradient(90deg, ${cfDialog.scaleMin}, ${cfDialog.scaleMid}, ${cfDialog.scaleMax})`
                  : `linear-gradient(90deg, ${cfDialog.scaleMin}, ${cfDialog.scaleMax})`,
            }"
          />
          <span class="sn-cf-fmt-label">Apply to range: {{ cfRangeLabel }}</span>
        </template>

        <!-- Data bars: horizontal bar inside each cell, proportional to value. -->
        <template v-else-if="cfDialog.kind === 'data-bar'">
          <div class="sn-cf-stop">
            <span>Bar colour</span>
            <ColorPicker
              v-model="cfDialog.barColor"
              title="Bar colour"
              :fallback="cfDialog.barColor"
            />
          </div>
          <div class="sn-cf-bar-preview">
            <div v-for="t in [0.25, 0.5, 0.85]" :key="t" class="sn-cf-bar-row">
              <div
                class="sn-cf-bar-fill"
                :style="{ width: t * 100 + '%', background: cfDialog.barColor }"
              />
            </div>
          </div>
          <span class="sn-cf-fmt-label">Apply to range: {{ cfRangeLabel }}</span>
        </template>

        <!-- Icon sets: small icons at the start of each cell based on bucket. -->
        <template v-else-if="cfDialog.kind === 'icon-set'">
          <FormControl
            v-model="cfDialog.iconSet"
            type="select"
            label="Icon set"
            :options="CF_ICON_SET_OPTIONS"
          />
          <span class="sn-cf-fmt-label">Apply to range: {{ cfRangeLabel }}</span>
          <p class="sn-cf-hint">Values are split into three equal buckets across the range.</p>
        </template>
      </div>
    </template>
    <template #actions>
      <div class="flex flex-row-reverse gap-2">
        <Button variant="solid" @click="saveCfRule">Apply</Button>
        <Button v-if="cfDialog.editId !== null" theme="red" @click="deleteCfRule">Delete</Button>
        <Button @click="cfDialog.open = false">Cancel</Button>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, reactive } from 'vue'

import { colLabel } from '../../utils/cells.js'
import ColorPicker from './ColorPicker.vue'

// The conditional-formatting dialog: the rule list for the open sheet and
// the editor for one rule. The editor opens it with open(ruleId, selection).
// Every change to the rules is bracketed by `before-change` and `changed`, so
// the editor can record an undo step on each side.
/** A 0-based cell rect. */
interface CfRange {
  r0: number
  c0: number
  r1: number
  c1: number
}

/** A rule as `engine/cond-format.js` stores it. */
interface CfRule {
  id: number
  range: CfRange
  kind?: string
  condition?: { type?: string; value?: string; value2?: string }
  format?: { color?: string; backgroundColor?: string }
  scale?: { variant?: string; minColor?: string; midColor?: string; maxColor?: string }
  bar?: { color?: string }
  icons?: { set?: string }
}

/** The part of the conditional-format engine the dialog uses. */
interface CondFormatEngine {
  getRules(sheet: string): CfRule[]
  addRule(rule: object, sheet: string): unknown
  updateRule(id: number, rule: object, sheet: string): unknown
  removeRule(id: number, sheet: string): unknown
}

const props = withDefaults(
  defineProps<{
    condFormat: CondFormatEngine
    currentSheet?: string
    // Ticks on every canvas render; the rule list re-reads on it.
    renderVersion?: number
  }>(),
  { currentSheet: '', renderVersion: 0 },
)
const emit = defineEmits<{ 'before-change': []; changed: [] }>()

const cfDialog = reactive({
  open: false,
  editId: null as number | null,
  range: {
    r0: 0,
    c0: 0,
    r1: 0,
    c1: 0,
  },
  // 'classic' = one-off condition (the original feature).
  // 'color-scale' / 'data-bar' / 'icon-set' = range-scoped scales.
  kind: 'classic',
  condType: 'gt',
  condValue: '',
  condValue2: '',
  fmtColor: '',
  fmtBg: '',
  // Scale-rule state (read only when `kind` is non-classic).
  scaleVariant: '2color',
  scaleMin: '#FFFFFF',
  scaleMid: '#FFEB3B',
  scaleMax: '#0E7490',
  barColor: '#0E7490',
  iconSet: 'arrows3',
})

const CF_COND_OPTIONS = [
  {
    label: 'Greater than',
    value: 'gt',
  },
  {
    label: 'Less than',
    value: 'lt',
  },
  {
    label: 'Greater or equal',
    value: 'gte',
  },
  {
    label: 'Less or equal',
    value: 'lte',
  },
  {
    label: 'Equal to',
    value: 'eq',
  },
  {
    label: 'Not equal to',
    value: 'neq',
  },
  {
    label: 'Between',
    value: 'between',
  },
  {
    label: 'Contains',
    value: 'contains',
  },
  {
    label: 'Does not contain',
    value: 'notcontains',
  },
  {
    label: 'Is empty',
    value: 'empty',
  },
  {
    label: 'Is not empty',
    value: 'notempty',
  },
]
const CF_KIND_OPTIONS = [
  {
    label: 'Single colour rule',
    value: 'classic',
  },
  {
    label: 'Colour scale',
    value: 'color-scale',
  },
  {
    label: 'Data bars',
    value: 'data-bar',
  },
  {
    label: 'Icon set',
    value: 'icon-set',
  },
]
const CF_SCALE_VARIANT_OPTIONS = [
  {
    label: '2-colour (low → high)',
    value: '2color',
  },
  {
    label: '3-colour (low → mid → high)',
    value: '3color',
  },
]
const CF_ICON_SET_OPTIONS = [
  {
    label: 'Arrows (red/grey/green)',
    value: 'arrows3',
  },
  {
    label: 'Traffic lights',
    value: 'traffic3',
  },
  {
    label: 'Circles (empty → full)',
    value: 'circles3',
  },
]
const cfRangeLabel = computed(() => {
  const { r0, c0, r1, c1 } = cfDialog.range
  return `${colLabel(c0)}${r0 + 1}:${colLabel(c1)}${r1 + 1}`
})

// `<input type="color">` rejects anything that isn't a literal #rrggbb.
// Old rules may have been saved with CSS-var values back when the dialog
// defaulted to `var(--surface-red-1)`; coerce those to '' so the input
// falls back to its default rather than throwing a DOMException.
function _coerceHex(v: unknown): string {
  if (typeof v !== 'string') return ''
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : ''
}
// Opens the dialog for a new rule on `selection` (existingId null), or to
// edit the rule `existingId`. A click in the rule list keeps the range.
function openRule(existingId: number | null, selection: CfRange | null = cfDialog.range) {
  const sel = selection || {
    r0: 0,
    c0: 0,
    r1: 0,
    c1: 0,
  }
  cfDialog.range = {
    ...sel,
  }
  cfDialog.editId = existingId
  cfDialog.kind = 'classic'
  cfDialog.condType = 'gt'
  cfDialog.condValue = ''
  cfDialog.condValue2 = ''
  cfDialog.fmtColor = ''
  // `<input type="color">` rejects CSS-var values — it requires a literal
  // #rrggbb. Use the resolved hex for --surface-red-1 instead.
  cfDialog.fmtBg = '#FEE2E2'
  cfDialog.scaleVariant = '2color'
  cfDialog.scaleMin = '#FFFFFF'
  cfDialog.scaleMid = '#FFEB3B'
  cfDialog.scaleMax = '#0E7490'
  cfDialog.barColor = '#0E7490'
  cfDialog.iconSet = 'arrows3'

  // If we're editing an existing rule, hydrate the dialog state from it so
  // the user sees their previous selections instead of the blank defaults.
  if (existingId !== null) {
    const existing = props.condFormat.getRules(props.currentSheet).find((r) => r.id === existingId)
    if (existing) {
      cfDialog.range = {
        ...existing.range,
      }
      cfDialog.kind = existing.kind || 'classic'
      if (existing.kind === 'color-scale') {
        cfDialog.scaleVariant = existing.scale?.variant || '2color'
        cfDialog.scaleMin = existing.scale?.minColor || cfDialog.scaleMin
        cfDialog.scaleMid = existing.scale?.midColor || cfDialog.scaleMid
        cfDialog.scaleMax = existing.scale?.maxColor || cfDialog.scaleMax
      } else if (existing.kind === 'data-bar') {
        cfDialog.barColor = existing.bar?.color || cfDialog.barColor
      } else if (existing.kind === 'icon-set') {
        cfDialog.iconSet = existing.icons?.set || cfDialog.iconSet
      } else {
        cfDialog.condType = existing.condition?.type || 'gt'
        cfDialog.condValue = existing.condition?.value ?? ''
        cfDialog.condValue2 = existing.condition?.value2 ?? ''
        cfDialog.fmtColor = _coerceHex(existing.format?.color) || ''
        cfDialog.fmtBg = _coerceHex(existing.format?.backgroundColor) || cfDialog.fmtBg
      }
    }
  }
  cfDialog.open = true
}
defineExpose({ open: openRule })

function _buildCfRule() {
  const range = {
    ...cfDialog.range,
  }
  if (cfDialog.kind === 'color-scale') {
    const scale =
      cfDialog.scaleVariant === '3color'
        ? {
            variant: '3color',
            minColor: cfDialog.scaleMin,
            midColor: cfDialog.scaleMid,
            maxColor: cfDialog.scaleMax,
            midPercent: 0.5,
          }
        : {
            variant: '2color',
            minColor: cfDialog.scaleMin,
            maxColor: cfDialog.scaleMax,
          }
    return {
      range,
      kind: 'color-scale',
      scale,
    }
  }
  if (cfDialog.kind === 'data-bar') {
    return {
      range,
      kind: 'data-bar',
      bar: {
        color: cfDialog.barColor,
      },
    }
  }
  if (cfDialog.kind === 'icon-set') {
    return {
      range,
      kind: 'icon-set',
      icons: {
        set: cfDialog.iconSet,
        thresholds: [0.33, 0.66],
      },
    }
  }
  // Classic single-colour rule.
  return {
    range,
    condition: {
      type: cfDialog.condType,
      value: cfDialog.condValue,
      value2: cfDialog.condValue2,
    },
    format: {
      ...(cfDialog.fmtColor
        ? {
            color: cfDialog.fmtColor,
          }
        : {}),
      ...(cfDialog.fmtBg && cfDialog.fmtBg !== '#ffffff'
        ? {
            backgroundColor: cfDialog.fmtBg,
          }
        : {}),
    },
  }
}
function saveCfRule() {
  const sn = props.currentSheet
  const rule = _buildCfRule()
  emit('before-change')
  if (cfDialog.editId !== null) props.condFormat.updateRule(cfDialog.editId, rule, sn)
  else props.condFormat.addRule(rule, sn)
  cfDialog.open = false
  emit('changed')
}
function deleteCfRule() {
  if (cfDialog.editId === null) return
  emit('before-change')
  props.condFormat.removeRule(cfDialog.editId, props.currentSheet)
  cfDialog.open = false
  emit('changed')
}

// Inline delete from the "existing rules" list — no need to open the dialog
// in edit mode first. Same history bracketing as deleteCfRule.
function deleteCfRuleById(id: number) {
  emit('before-change')
  props.condFormat.removeRule(id, props.currentSheet)
  emit('changed')
}

// Pretty label for the rule list. Mirrors CF_KIND_OPTIONS / CF_COND_OPTIONS.
function cfRuleLabel(rule: CfRule): string {
  const r = rule.range
  const range = `${colLabel(r.c0)}${r.r0 + 1}:${colLabel(r.c1)}${r.r1 + 1}`
  if (rule.kind === 'color-scale') return `${range} · Colour scale`
  if (rule.kind === 'data-bar') return `${range} · Data bars`
  if (rule.kind === 'icon-set') return `${range} · Icon set`
  const t = rule.condition?.type
  const v = rule.condition?.value
  const summary =
    t === 'between'
      ? `between ${v} and ${rule.condition?.value2}`
      : t === 'empty' || t === 'notempty'
        ? t
        : `${t} ${v}`
  return `${range} · ${summary}`
}

// Existing rules for the active sheet.
const cfRulesForSheet = computed(() => {
  // Touch renderVersion so the list re-evaluates when rules are mutated.
  void props.renderVersion
  return props.condFormat.getRules(props.currentSheet)
})
</script>

<style scoped>
/* Colour-picker trigger buttons, as in the toolbar (SheetEditor.css). */
.sn-swatch-btn {
  position: relative;
  height: 28px;
  width: 28px;
  border-radius: 6px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid transparent;
  gap: 1px;
  transition: background-color 0.12s;
  background: transparent;
  padding: 0;
}
.sn-swatch-btn:hover,
.sn-swatch-btn.is-open {
  background: var(--surface-gray-3);
}
.sn-swatch-glyph {
  width: 14px;
  height: 14px;
  color: var(--ink-gray-8);
  pointer-events: none;
}
.sn-swatch-underline {
  width: 16px;
  height: 3px;
  border-radius: 1px;
  pointer-events: none;
}
.sn-swatch-fill {
  border: 1px solid var(--outline-gray-2);
}

/* Conditional format dialog rows */
.sn-form-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sn-cf-fmt {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.sn-cf-fmt-label {
  font-size: 12px;
  color: var(--ink-gray-6);
  flex: 1;
}
.sn-cf-hint {
  font-size: 11px;
  color: var(--ink-gray-5);
  margin: 0;
  line-height: 1.4;
}

/* Colour-scale stop pickers + gradient preview strip */
.sn-cf-scale {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
.sn-cf-stop {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-gray-6);
}
.sn-cf-stop input {
  width: 32px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--outline-gray-2);
  border-radius: 6px;
  cursor: pointer;
}
.sn-cf-scale-preview {
  height: 18px;
  width: 100%;
  border-radius: 4px;
  border: 1px solid var(--outline-gray-2);
}

/* Data-bar preview rows — three bars at sample widths so users can sanity-check the colour. */
.sn-cf-bar-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: var(--surface-gray-1);
  border-radius: 6px;
  border: 1px solid var(--outline-gray-2);
}
.sn-cf-bar-row {
  height: 14px;
  background: var(--surface-base);
  border-radius: 3px;
  overflow: hidden;
}
.sn-cf-bar-fill {
  height: 100%;
  opacity: 0.55;
}

/* Existing-rules list at the top of the CF dialog. */
.sn-cf-rule-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--surface-gray-1);
  border: 1px solid var(--outline-gray-2);
  border-radius: 6px;
}
.sn-cf-rule-list-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-gray-6);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 4px 4px;
}
.sn-cf-rule-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sn-cf-rule-pick {
  flex: 1;
  text-align: left;
  font-size: 12px;
  color: var(--ink-gray-8);
  background: var(--surface-base);
  border: 1px solid var(--outline-gray-2);
  border-radius: 5px;
  padding: 6px 8px;
  cursor: pointer;
}
.sn-cf-rule-pick:hover {
  background: var(--surface-gray-2);
}
.sn-cf-rule-row--active .sn-cf-rule-pick {
  border-color: var(--ink-gray-9);
}
</style>
