<script setup lang="ts">
import { RouterView } from 'vue-router'

// Light by default, for now: the runtime otherwise falls back to the viewer's
// own prefers-color-scheme, so the prototype opens dark on a dark machine.
// Delete these two lines to hand the theme back to Sketch.
document.documentElement.dataset.theme = 'light'
</script>

<template>
  <!--
    Pinned to the viewport rather than laid out in the document flow. `h-screen`
    is the right height but still sits in the page, so anything that gives the
    document a scrollbar can carry the whole shell off the top of the window,
    taking the chrome and every panel header with it. `fixed inset-0` cannot be
    moved by a scroll, whatever causes one — and it leaves an overlay's own
    scroll locking alone rather than fighting it for the page's overflow.
  -->
  <div class="fixed inset-0 overflow-hidden bg-surface-base text-ink-gray-9">
    <RouterView />
  </div>
</template>
