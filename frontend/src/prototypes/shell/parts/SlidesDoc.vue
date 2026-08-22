<!--
  PROTOTYPE — remove. Mounts the real Slides editor inside the shell's content
  area.

  Slides is the one app that needed changing to sit here: its editor loads on
  its own route name and rewrites the URL after loading, both of which fight a
  foreign shell. `embedded` is the switch that turns those off.
-->
<template>
  <div class="slides-pane flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <!-- editorAccess is deliberately not passed: the editor then asks the
         server what this user may do, instead of being told to trust us. -->
    <PresentationEditor :presentation-id="id" :active-slide-id="1" embedded />
  </div>
</template>

<script setup lang="ts">
import PresentationEditor from '@/apps/slides/pages/PresentationEditor.vue'
// Slides ships these faces itself and only its own shell loads them. Without
// this the deck's fonts silently fall back.
import '@/apps/slides/styles/fonts.css'

defineProps<{ id: string }>()
</script>
