<template>
  <Section label="Background">
    <PropertyRow label="Fill">
      <ColorPicker
        :modelValue="currentSlide.background"
        @update:modelValue="background.set"
        @colordown="background.begin"
        @colorup="background.commit"
      />
    </PropertyRow>
  </Section>
</template>

<script setup>
import ColorPicker from '@/apps/slides/components/controls/ColorPicker.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import Section from '@/apps/slides/components/controls/Section.vue'
import { useSlideProperty } from '@/apps/slides/composables/editProperty'
import { currentSlide } from '@/apps/slides/stores/slide'

const background = useSlideProperty('background')
</script>
