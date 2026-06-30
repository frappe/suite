<template>
  <!-- Mobile / narrow-tablet blocker. The canvas grid has no touch support
       today, so we hide the editor behind this overlay below 720px. The
       underlying editor still mounts so state is preserved on rotate-back. -->
  <div class="sn-mobile-blocker">
    <div class="sn-mobile-card">
      <svg width="56" height="56" viewBox="0 0 118 118" fill="none">
        <path d="M93.9278 0H23.1013C10.3428 0 0 10.3428 0 23.1013V93.9278C0 106.686 10.3428 117.029 23.1013 117.029H93.9278C106.686 117.029 117.029 106.686 117.029 93.9278V23.1013C117.029 10.3428 106.686 0 93.9278 0Z" fill="#278F5E" />
        <path d="M77.757 25.9364H23.5215V36.437H77.757C80.6447 36.437 83.0073 38.7996 83.0073 41.6873V75.3942C83.0073 78.2818 80.6447 80.6445 77.757 80.6445H39.2724C36.3847 80.6445 34.0221 78.2818 34.0221 75.3942V50.6653H23.5215V75.3942C23.5215 84.0572 30.6094 91.1451 39.2724 91.1451H77.757C86.42 91.1451 93.5079 84.0572 93.5079 75.3942V41.6873C93.5079 33.0243 86.42 25.9364 77.757 25.9364Z" fill="white" />
        <path d="M53.8678 59.6958H43.3672V70.0914H53.8678V59.6958Z" fill="white" />
        <path d="M73.6617 50.6653H63.1611V70.1439H73.6617V50.6653Z" fill="white" />
      </svg>
      <h2>Open on desktop</h2>
      <p>
        Frappe Sheets is built for desktop browsers — mobile and tablet support
        is on the roadmap. Please come back from a laptop or PC.
      </p>
    </div>
  </div>

  <SheetEditor :id="id" @close="goHome" @saved="onSaved" />
  <Dialogs />
</template>

<script setup>
import { Dialogs } from 'frappe-ui'
import { useRouter } from 'vue-router'

import SheetEditor from '@/apps/sheets/components/SheetEditor/index.vue'

defineProps({
  // The sheet name (route param). 'new' is the special create id, preserved
  // from the standalone app's `?id=new`.
  id: { type: String, default: 'new' },
})

const router = useRouter()

function goHome() {
  router.push({ name: 'sheets-home' })
}

// After a brand-new sheet is persisted the editor emits the server-assigned
// name; swap the URL (replace, not push) from /sheets/new to /sheets/<name>
// so a reload / share-link points at the real doc — mirrors the old
// history.replaceState(`?id=${name}`).
function onSaved(name) {
  if (!name) return
  router.replace({ name: 'sheets-editor', params: { id: name } })
}
</script>

<style scoped>
.sn-mobile-blocker {
  display: none;
}
@media (max-width: 720px) {
  .sn-mobile-blocker {
    display: flex;
    position: fixed;
    inset: 0;
    z-index: 99999;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--surface-gray-1, #f8f8f8);
    font-family: InterVar, ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-gray-9, #171717);
  }
  .sn-mobile-card {
    max-width: 360px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 32px 24px;
    border-radius: 14px;
    background: var(--surface-base, #ffffff);
    border: 1px solid var(--outline-gray-2, #e2e2e2);
    box-shadow:
      0 0 1px rgba(0, 0, 0, 0.35),
      0 6px 8px -4px rgba(0, 0, 0, 0.1);
  }
  .sn-mobile-card h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }
  .sn-mobile-card p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    letter-spacing: 0.02em;
    color: var(--ink-gray-7, #525252);
  }
}
</style>
