<template>
  <!-- The editor's own top bar (outside Drive's /d/ surface): the Sheets menu,
  the title, save state and the slots for status chips and actions. -->
  <div class="sn-topbar">
    <div class="sn-topbar-left">
      <div class="sn-identity">
        <Dropdown :options="brandMenuOptions" :offset="16">
          <template #default="{ open }">
            <Tooltip text="Open Sheets menu">
              <div class="sn-app-menu-trigger" aria-label="Open Sheets menu">
                <svg
                  class="sn-app-icon"
                  width="28"
                  height="28"
                  viewBox="0 0 118 118"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M93.9278 0H23.1013C10.3428 0 0 10.3428 0 23.1013V93.9278C0 106.686 10.3428 117.029 23.1013 117.029H93.9278C106.686 117.029 117.029 106.686 117.029 93.9278V23.1013C117.029 10.3428 106.686 0 93.9278 0Z"
                    fill="#278F5E"
                  />
                  <path
                    d="M77.757 25.9364H23.5215V36.437H77.757C80.6447 36.437 83.0073 38.7996 83.0073 41.6873V75.3942C83.0073 78.2818 80.6447 80.6445 77.757 80.6445H39.2724C36.3847 80.6445 34.0221 78.2818 34.0221 75.3942V50.6653H23.5215V75.3942C23.5215 84.0572 30.6094 91.1451 39.2724 91.1451H77.757C86.42 91.1451 93.5079 84.0572 93.5079 75.3942V41.6873C93.5079 33.0243 86.42 25.9364 77.757 25.9364Z"
                    fill="white"
                  />
                  <path d="M53.8678 59.6958H43.3672V70.0914H53.8678V59.6958Z" fill="white" />
                  <path d="M73.6617 50.6653H63.1611V70.1439H73.6617V50.6653Z" fill="white" />
                </svg>
                <FeatherIcon
                  :name="open ? 'chevron-up' : 'chevron-down'"
                  class="size-4 text-ink-gray-7"
                />
              </div>
            </Tooltip>
          </template>
        </Dropdown>
        <Breadcrumbs v-if="!isTitleEditing" :items="sheetBreadcrumbs" />
        <template v-else>
          <div class="flex min-w-0 items-center">
            <Breadcrumbs class="sn-parent-breadcrumb" :items="sheetHomeBreadcrumbs" />
            <span class="mx-0.5 text-base text-ink-gray-4" aria-hidden="true">/</span>
            <InlineTitleInput
              :model-value="title"
              class="max-w-[520px]"
              @update:model-value="emit('update:title', $event)"
              @submit="emit('finish-title')"
              @cancel="emit('cancel-title')"
              @blur="emit('finish-title')"
            />
          </div>
        </template>
      </div>
      <!-- Save status — muted inline text; never competes with the title -->
      <span v-if="isSaving" class="sn-save-status" aria-label="Saving…">
        <FeatherIcon name="loader" class="sn-save-icon sn-save-spin" />
        <span class="sn-save-label">Saving…</span>
      </span>
      <span v-else-if="justSaved" class="sn-save-status" aria-label="Saved">
        <FeatherIcon name="check" class="sn-save-icon" />
        <span class="sn-save-label">Saved</span>
      </span>
      <slot name="status" />
      <!-- View-only indicator — shown up front so a viewer knows they can't
         edit before they try. Neutral gray (not an error) because read
         access is expected, not a failure. Uses the Frappe UI Badge so it
         matches the save-error chip beside it and the Espresso tokens. -->
      <Tooltip
        v-if="readOnly"
        text="You have view access. Ask the owner for edit access to make changes."
      >
        <Badge theme="gray" variant="subtle" size="lg" aria-label="View only">
          <template #prefix><FeatherIcon name="eye" class="h-3.5 w-3.5" /></template>
          <span class="sn-view-only-label">View only</span>
        </Badge>
      </Tooltip>
    </div>
    <div class="sn-topbar-right">
      <slot name="actions" />
      <Avatar
        :label="userInitial"
        :image="userImage || undefined"
        size="sm"
        :tooltip="userFullName || userEmail"
        class="sn-user-avatar"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// The standalone top bar, extracted from SheetEditor/index.vue. Title editing
// state and the save flags stay in the editor; this renders them and reports
// title edits back.
import {
  Avatar,
  Badge,
  Breadcrumbs,
  Dropdown,
  Tooltip,
  type BreadcrumbsProps,
  type DropdownOptions,
} from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import InlineTitleInput from './InlineTitleInput.vue'

defineProps<{
  title: string
  brandMenuOptions: DropdownOptions
  isTitleEditing: boolean
  sheetBreadcrumbs: BreadcrumbsProps['items']
  sheetHomeBreadcrumbs: BreadcrumbsProps['items']
  isSaving: boolean
  justSaved: boolean
  readOnly: boolean
  userInitial: string
  userImage?: string | null
  userFullName?: string
  userEmail?: string
}>()
const emit = defineEmits<{
  'update:title': [title: string]
  'finish-title': []
  'cancel-title': []
}>()
</script>

<style scoped>
/* ── Bar 1 · Identity / topbar ───────────────────────────────────────────── */
.sn-topbar {
  container: sn-topbar / inline-size;
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--outline-elevation-1);
  background: var(--surface-elevation-1);
  flex-shrink: 0;
}
/* Left cluster groups: brand+title tight (gap:4); status chips sit further away
   (gap:12) so the title reads as the focal point, not crowded by badges. */
.sn-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.sn-topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.sn-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.sn-app-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: block;
}
.sn-app-menu-trigger {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.sn-parent-breadcrumb :deep(a) {
  color: var(--ink-gray-5);
}
/* Brand-coloured current-user avatar. Avatar's inner label uses
   `bg-surface-gray-2 text-ink-gray-5` by default — we override both so the
   chip reads as "you" against the otherwise-neutral topbar. Scoped styles
   need `:deep()` to reach into frappe-ui's component internals. */
.sn-user-avatar :deep(div) {
  background: #0d7490 !important;
  color: #ffffff !important;
}

/* Save status — small muted text, Espresso ink-gray-5.  Sits quietly next to
   the title; never competes for attention. */
.sn-save-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.01em;
  color: var(--ink-gray-5);
  white-space: nowrap;
  user-select: none;
}
.sn-save-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
@keyframes sn-spin {
  to {
    transform: rotate(360deg);
  }
}
.sn-save-spin {
  animation: sn-spin 0.9s linear infinite;
}
/* A narrow bar drops the save label and the view-only label (the matching
   rules for the actions live in SheetTopbarActions.vue). */
@container sn-topbar (max-width: 640px) {
  .sn-save-label,
  .sn-view-only-label {
    display: none;
  }
}
</style>
