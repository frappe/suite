import { computed, onScopeDispose, ref } from 'vue'

const THRESHOLD = 3
const PX_PER_STEP = 4

function wrap(value, size) {
  return ((value % size) + size) % size
}

export function useDragScrub({ disabled, onStart, onStep, onEnd }) {
  const isScrubbing = ref(false)
  const cursorX = ref(0)
  const cursorY = ref(0)

  let dx = 0
  let dy = 0
  let pointerX = 0
  let pointerY = 0

  const cursorStyle = computed(() => ({ left: `${cursorX.value}px`, top: `${cursorY.value}px` }))

  function start(event) {
    if (disabled?.value) return

    dx = 0
    dy = 0

    pointerX = event.clientX
    pointerY = event.clientY

    isScrubbing.value = false

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
  }

  function move(event) {
    dx += event.movementX
    dy += event.movementY

    if (!isScrubbing.value) {
      if (Math.abs(dx) < THRESHOLD) return
      isScrubbing.value = true
      onStart(event)
      document.body.requestPointerLock?.()?.catch?.(() => {})
      window.getSelection()?.removeAllRanges()
      document.body.style.userSelect = 'none'
    }

    event.preventDefault()

    cursorX.value = wrap(pointerX + dx, window.innerWidth)
    cursorY.value = wrap(pointerY + dy, window.innerHeight)

    onStep(Math.round(dx / PX_PER_STEP), event)
  }

  function end() {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', end)

    if (!isScrubbing.value) return

    isScrubbing.value = false

    if (document.pointerLockElement) document.exitPointerLock()
    document.body.style.userSelect = ''
    onEnd()
  }

  onScopeDispose(end)

  return { isScrubbing, cursorStyle, start }
}
