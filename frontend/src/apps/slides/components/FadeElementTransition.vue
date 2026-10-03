<template>
  <transition-group
    tag="div"
    @before-enter="beforeEnter"
    @enter="enter"
    @after-enter="afterEnter"
    @before-leave="beforeLeave"
  >
    <slot></slot>
  </transition-group>
</template>

<script setup>
const props = defineProps({
  duration: {
    type: Number,
    default: 0,
  },
  skip: {
    type: Boolean,
    default: false,
  },
})

const beforeEnter = (el) => {
  if (props.skip) return

  el.style.opacity = 0
  el.style.transition = 'none'
}

const enter = (el, done) => {
  if (props.skip) return done()

  el.offsetWidth

  el.style.transitionProperty = 'all'
  el.style.transitionTimingFunction = 'ease-in-out'
  el.style.transitionDuration = `${1}s`
  el.style.transitionDelay = `${props.duration + 0.1}s`
  el.style.opacity = 1

  el.addEventListener('transitionend', done, { once: true })
}

const afterEnter = (el) => {
  if (props.skip) return

  el.style.transition = ''
}

const beforeLeave = (el) => {
  el.style.transition = 'none'
  el.style.opacity = 0
}
</script>
