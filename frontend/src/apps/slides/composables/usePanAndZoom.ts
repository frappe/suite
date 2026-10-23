import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

type Origin = {
  x: number
  y: number
}

type Transform = {
  origin: Origin
  scale: number
  translation: {
    x: number
    y: number
  }
}

export const usePanAndZoom = (containerElement: any, targetElement: any, initialScale = 1) => {
  const allowPanAndZoom = ref(true)

  const SCALE_SPEED = 0.8
  const TRANSLATE_SPEED = 0.8

  let origin: Origin, transformObj: Transform | null

  let initialX: number, initialY: number
  let initialMatrix = new DOMMatrix()
  let gestureMatrix = new DOMMatrix()

  let wheelTimeout: ReturnType<typeof setTimeout>

  const transform = ref(`matrix(${initialScale}, 0, 0, ${initialScale}, 0, 0)`)
  const transformOrigin = ref('0 0')

  const isPanningOrZooming = ref(false)

  const setOrigin = () => {
    if (!transformObj) return
    // origin is the midpoint of the initial touch points
    origin = {
      x: transformObj.origin.x - initialX,
      y: transformObj.origin.y - initialY,
    }
  }

  const startGesture = () => {
    transform.value = ''
    isPanningOrZooming.value = true
    setOrigin()
    setGestureMatrix()
    applyMatrix()
  }

  const updateGesture = () => {
    limitScale()
    limitTranslation()
    setGestureMatrix()
    applyMatrix()
  }

  const endGesture = () => {
    limitScale()
    limitTranslation()
    setGestureMatrix()
    // while ending transform, apply the final transformation matrix
    initialMatrix = gestureMatrix
    applyMatrix()
    isPanningOrZooming.value = false
  }

  const limitScale = () => {
    if (!transformObj) return
    // previous scale for transformation matrix is length of hypotenuse of x and y components
    let scale = Math.hypot(initialMatrix.a, initialMatrix.b)
    let currentScale = transformObj.scale * scale

    if (currentScale > 5 || currentScale < 0.5) {
      transformObj.scale = Math.max(0.5, Math.min(5, currentScale)) / scale
    }
  }

  const limitTranslation = () => {
    if (!transformObj) return
    let nextX = transformObj.translation.x + initialMatrix.e
    let nextY = transformObj.translation.y + initialMatrix.f

    let scale = Math.hypot(initialMatrix.a, initialMatrix.b)

    // if target goes out of bounds from top or bottom
    // reduce the translation on Y axis
    let ylimit = scale < 1 ? 500 * scale : 500
    if (nextY > ylimit) transformObj.translation.y = ylimit - initialMatrix.f
    else if (nextY < -ylimit) transformObj.translation.y = -ylimit - initialMatrix.f

    // if target goes out of bounds from top or bottom
    // reduce the translation on X axis
    let xlimit = scale < 1 ? 800 * scale : 800
    if (nextX > xlimit) transformObj.translation.x = xlimit - initialMatrix.e
    else if (nextX < -xlimit) transformObj.translation.x = -xlimit - initialMatrix.e
  }

  const setGestureMatrix = () => {
    if (!transformObj) return
    let matrix = new DOMMatrix()
      .translate(origin.x, origin.y)
      .translate(transformObj.translation.x, transformObj.translation.y)
      .scale(transformObj.scale || 1)
      .translate(-origin.x, -origin.y)

    gestureMatrix = matrix.multiply(initialMatrix)
  }

  const applyMatrix = () => {
    transform.value = gestureMatrix.toString()
  }

  const setZoomTransform = (e: WheelEvent) => {
    if (!transformObj) return
    let dy = e.deltaY * SCALE_SPEED
    let factor = e.deltaY <= 0 ? 1 - dy / 100 : 1 / (1 + dy / 100)
    transformObj = {
      origin: { x: e.clientX, y: e.clientY },
      scale: transformObj.scale * factor,
      translation: transformObj.translation,
    }
  }

  const setPanTransform = (e: WheelEvent) => {
    if (!transformObj) return
    let dx = e.deltaX * TRANSLATE_SPEED
    let dy = e.deltaY * TRANSLATE_SPEED
    transformObj = {
      origin: { x: e.clientX, y: e.clientY },
      scale: transformObj.scale,
      translation: {
        x: transformObj.translation.x - dx,
        y: transformObj.translation.y - dy,
      },
    }
  }

  const handlePanAndZoom = (e: WheelEvent) => {
    e.preventDefault()

    // initialize the transformObj
    if (!transformObj) {
      transformObj = {
        origin: { x: e.clientX, y: e.clientY },
        scale: 1,
        translation: { x: 0, y: 0 },
      }
      startGesture()
    }

    if (e.ctrlKey) {
      setZoomTransform(e)
    } else {
      setPanTransform(e)
    }

    // incrementally update the transformObj
    updateGesture()

    if (wheelTimeout) window.clearTimeout(wheelTimeout)
    wheelTimeout = setTimeout(() => {
      // apply the final transformation
      endGesture()
      transformObj = null
    }, 500)
  }

  const addPanAndZoom = () => {
    if (!containerElement.value || !targetElement.value) return
    initialMatrix = new DOMMatrix().scale(initialScale)
    gestureMatrix = new DOMMatrix()
    let rect = targetElement.value.getBoundingClientRect()
    initialX = rect.x
    initialY = rect.y
    containerElement.value.addEventListener('wheel', handlePanAndZoom, {
      passive: false,
    })
  }

  const removePanAndZoom = () => {
    if (!containerElement.value) return
    if (wheelTimeout) window.clearTimeout(wheelTimeout)
    transform.value = `matrix(${initialScale}, 0, 0, ${initialScale}, 0, 0)`
    transformOrigin.value = '0 0'
    containerElement.value.removeEventListener('wheel', handlePanAndZoom)
  }

  watch(
    () => allowPanAndZoom.value,
    (value: boolean) => {
      value ? addPanAndZoom() : removePanAndZoom()
    },
  )

  onMounted(() => {
    if (allowPanAndZoom.value) addPanAndZoom()
  })

  onBeforeUnmount(() => {
    removePanAndZoom()
  })

  return {
    transform,
    transformOrigin,
    allowPanAndZoom,
    isPanningOrZooming,
  }
}
